"""Conservative frame-ingestion API. No model adapter is enabled by default."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Deque

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel

from vision_ocr import read_orange_price

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("otc_vision.ocr")
app = FastAPI(title="AI Universal Signal Radar", version="0.1.0")
TOKEN = os.getenv("RADAR_INGEST_TOKEN", "")
MAX_FRAME_BYTES = 4 * 1024 * 1024
MAX_HISTORY = 120


@dataclass
class SessionState:
    started_at: float = field(default_factory=time.time)
    last_sequence: int = -1
    last_seen: float = 0.0
    hashes: Deque[str] = field(default_factory=lambda: deque(maxlen=MAX_HISTORY))
    frames_seen: int = 0


sessions: dict[str, SessionState] = defaultdict(SessionState)


class Decision(BaseModel):
    signal: str = "STANDBY"
    status: str = "MODEL_NOT_CONFIGURED"
    reason: str
    session_id: str | None = None
    sequence: int | None = None
    observed_at: float | None = None
    asset: str | None = None
    timeframe: str | None = None
    price: str | None = None
    evidence: list[str] = []


def authorize(authorization: str | None) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="Server ingest token is not configured")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _emit_ocr_frame(
    *,
    orange_tag_found: bool,
    ocr_raw_text: str,
    extracted_price: str | None,
    status: str,
    processing_ms: int,
    session_id: str,
    sequence: int,
    frame_width: int | None = None,
    frame_height: int | None = None,
    reason: str | None = None,
) -> None:
    """Emit one parseable JSON object for every frame that reaches OCR."""
    record = {
        "event": "OCR_FRAME",
        "session_id": session_id,
        "sequence": sequence,
        "orange_tag_found": bool(orange_tag_found),
        "ocr_raw_text": ocr_raw_text,
        "extracted_price": extracted_price,
        "status": status,
        "processing_ms": processing_ms,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "reason": reason,
    }
    logger.info(json.dumps(record, ensure_ascii=False, separators=(",", ":")))


@app.get("/health")
def health():
    return {"ok": True, "service": "ai-universal-signal-radar", "analysis": "standby-only"}


@app.post("/v1/session/start")
def start_session(authorization: str | None = Header(default=None), session_id: str = Form(...)):
    authorize(authorization)
    if not session_id or len(session_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    sessions[session_id] = SessionState()
    return {"ok": True, "session_id": session_id, "state": "CAPTURING"}


@app.post("/v1/session/stop")
def stop_session(authorization: str | None = Header(default=None), session_id: str = Form(...)):
    authorize(authorization)
    sessions.pop(session_id, None)
    return {"ok": True, "session_id": session_id, "state": "STOPPED"}


@app.post("/v1/frame", response_model=Decision)
async def ingest_frame(
    authorization: str | None = Header(default=None),
    session_id: str = Form(...),
    sequence: int = Form(...),
    captured_at_ms: int = Form(...),
    width: int = Form(...),
    height: int = Form(...),
    image: UploadFile = File(...),
):
    authorize(authorization)
    if not session_id or len(session_id) > 128 or sequence < 0:
        raise HTTPException(status_code=400, detail="Invalid frame metadata")
    if width < 1 or height < 1 or width > 10000 or height > 10000:
        raise HTTPException(status_code=400, detail="Invalid image dimensions")
    payload = await image.read(MAX_FRAME_BYTES + 1)
    if not payload or len(payload) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame empty or exceeds 4 MB")
    if not payload.startswith(b"\xff\xd8") and not payload.startswith(b"\x89PNG"):
        raise HTTPException(status_code=415, detail="Only JPEG or PNG frames are accepted")
    now_ms = int(time.time() * 1000)
    if captured_at_ms > now_ms + 30_000 or now_ms - captured_at_ms > 30_000:
        raise HTTPException(status_code=409, detail="Stale or future frame rejected")

    state = sessions[session_id]
    if sequence <= state.last_sequence:
        raise HTTPException(status_code=409, detail="Duplicate or out-of-order frame")
    digest = hashlib.sha256(payload).hexdigest()
    state.last_sequence = sequence
    state.last_seen = time.time()
    state.frames_seen += 1
    state.hashes.append(digest)

    # OCR uses the decoded JPEG/PNG dimensions for every ROI calculation.
    processing_started = time.perf_counter()
    orange_tag_found = False
    ocr_raw_text = ""
    extracted_price = None
    frame_width = None
    frame_height = None
    ocr_status = "ERROR"
    ocr_reason = None
    tag_box = None
    try:
        ocr = read_orange_price(payload)
        orange_tag_found = ocr.orange_tag_found
        ocr_raw_text = ocr.raw_text
        extracted_price = ocr.price
        frame_width = ocr.frame_width
        frame_height = ocr.frame_height
        ocr_status = "SUCCESS" if ocr.status == "PRICE_READ" else "NO_VALID_PRICE"
        ocr_reason = ocr.reason
        tag_box = ocr.tag_box

        status = (
            "PRICE_READ_ENGINE_NOT_CONFIGURED"
            if ocr.status == "PRICE_READ" else ocr.status
        )
        reason = (
            "Price extracted by server OCR; directional 10-engine adapter is not configured."
            if ocr.status == "PRICE_READ" else ocr.reason
        )
        evidence = [
            f"frame_sha256:{digest[:16]}",
            f"server_ocr:{ocr.status}",
            "directional_signal_suppressed",
        ]
        if ocr.tag_box:
            evidence.append("orange_tag_box:" + ",".join(map(str, ocr.tag_box)))
        evidence.extend("price_candidate:" + candidate for candidate in ocr.candidates)
    except Exception as exc:
        status = "SERVER_OCR_ERROR"
        ocr_status = "ERROR"
        ocr_reason = type(exc).__name__
        reason = "Server OCR failed safely: " + type(exc).__name__
        evidence = [f"frame_sha256:{digest[:16]}", "directional_signal_suppressed"]
        logger.exception(
            "OCR_FRAME_EXCEPTION session=%s sequence=%s", session_id, sequence
        )
    finally:
        processing_ms = int((time.perf_counter() - processing_started) * 1000)
        _emit_ocr_frame(
            orange_tag_found=orange_tag_found,
            ocr_raw_text=ocr_raw_text,
            extracted_price=extracted_price,
            status=ocr_status,
            processing_ms=processing_ms,
            session_id=session_id,
            sequence=sequence,
            frame_width=frame_width,
            frame_height=frame_height,
            reason=ocr_reason,
        )

    # Price extraction is not a directional signal; keep the response STANDBY.
    return Decision(
        signal="STANDBY",
        status=status,
        reason=reason,
        session_id=session_id,
        sequence=sequence,
        observed_at=captured_at_ms / 1000.0,
        price=extracted_price,
        evidence=evidence,
    )
