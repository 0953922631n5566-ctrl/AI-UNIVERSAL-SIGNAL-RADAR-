"""Conservative frame-ingestion API. No model adapter is enabled by default."""
from __future__ import annotations

import hashlib
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Deque

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from vision_ocr import read_orange_price

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
    evidence: list[str] = []
    price_candidate: str | None = None
    price_confidence: float = 0.0


def authorize(authorization: str | None) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="Server ingest token is not configured")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


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

    # OCR extracts a candidate only; market type and directional logic remain unverified.
    price, confidence, detail = read_orange_price(payload)
    return Decision(
        signal="STANDBY",
        status="PRICE_CANDIDATE_ONLY" if price else "ORANGE_BADGE_NOT_FOUND",
        reason="Price OCR candidate only. NON-OTC market type and candle history are not verified; signals remain disabled.",
        session_id=session_id,
        sequence=sequence,
        observed_at=captured_at_ms / 1000.0,
        evidence=[f"frame_sha256:{digest[:16]}", detail, "market_type_unverified", "directional_signal_suppressed"],
        price_candidate=price,
        price_confidence=confidence,
    )
