"""Server-side orange price-tag detection and OCR. No directional engine is enabled."""
from __future__ import annotations

import re
from dataclasses import dataclass

import cv2
import numpy as np
import pytesseract


@dataclass(frozen=True)
class PriceRead:
    status: str
    price: str | None
    candidates: tuple[str, ...]
    reason: str
    tag_box: tuple[int, int, int, int] | None = None


_PRICE_RE = re.compile(r"(?<!\d)(\d{1,2})[.,](\d{3,6})(?!\d)")


def parse_price_candidates(text: str) -> tuple[str, ...]:
    cleaned = text.replace("O", "0").replace("o", "0").replace("I", "1").replace("l", "1")
    found: list[str] = []
    for match in _PRICE_RE.finditer(cleaned):
        candidate = match.group(1) + "." + match.group(2)
        if candidate not in found:
            found.append(candidate)
    return tuple(found)


def read_orange_price(image_bytes: bytes) -> PriceRead:
    """Detect an orange right-axis tag, crop/upscale/denoise, then OCR its digits."""
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        return PriceRead("INVALID_IMAGE", None, (), "Server could not decode the uploaded image")
    height, width = frame.shape[:2]
    if width < 240 or height < 320:
        return PriceRead("IMAGE_TOO_SMALL", None, (), "Uploaded screenshot dimensions are too small")

    # Restrict tag search to the right-hand price axis to avoid unrelated orange UI.
    x0, x1 = int(width * 0.72), width
    y0, y1 = int(height * 0.08), int(height * 0.92)
    axis = frame[y0:y1, x0:x1]
    hsv = cv2.cvtColor(axis, cv2.COLOR_BGR2HSV)
    orange_mask = cv2.inRange(hsv, np.array([4, 75, 70]), np.array([38, 255, 255]))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    orange_mask = cv2.morphologyEx(orange_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(orange_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    axis_area = max(1, axis.shape[0] * axis.shape[1])
    candidates: list[tuple[float, int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < axis_area * 0.00015 or area > axis_area * 0.12:
            continue
        if w < 24 or h < 10:
            continue
        aspect = w / max(1, h)
        if aspect < 0.8 or aspect > 12:
            continue
        # Prefer compact orange labels nearest the far-right price axis.
        right_bias = (x + w) / max(1, axis.shape[1])
        score = area * (0.5 + right_bias)
        candidates.append((score, x, y, w, h))

    if not candidates:
        return PriceRead("ORANGE_TAG_NOT_FOUND", None, (), "No orange price tag was detected on the right axis")

    _, x, y, w, h = max(candidates, key=lambda item: item[0])
    pad_x, pad_y = max(4, int(w * 0.08)), max(3, int(h * 0.12))
    left = max(0, x0 + x - pad_x)
    top = max(0, y0 + y - pad_y)
    right = min(width, x0 + x + w + pad_x)
    bottom = min(height, y0 + y + h + pad_y)
    tag = frame[top:bottom, left:right]
    if tag.size == 0:
        return PriceRead("INVALID_TAG_CROP", None, (), "Detected tag crop is empty")

    enlarged = cv2.resize(tag, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(gray)
    denoised = cv2.medianBlur(gray, 3)
    threshold = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 9
    )
    config = "--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789.,"
    texts = [
        pytesseract.image_to_string(threshold, config=config),
        pytesseract.image_to_string(cv2.bitwise_not(threshold), config=config),
    ]
    reads = tuple(dict.fromkeys(
        price for raw in texts for price in parse_price_candidates(raw)
    ))
    box = (left, top, right, bottom)
    if len(reads) == 1:
        return PriceRead("PRICE_READ", reads[0], reads, "One price candidate extracted from orange tag", box)
    if len(reads) > 1:
        return PriceRead("AMBIGUOUS_PRICE", None, reads, "Multiple price candidates detected; no price selected", box)
    return PriceRead("NO_VALID_PRICE", None, (), "Orange tag found but no valid price text was recognized", box)
