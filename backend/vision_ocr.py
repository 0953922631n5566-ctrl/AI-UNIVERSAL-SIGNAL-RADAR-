"""Orange floating quote badge OCR. Candidate extraction only; never emits a trade direction."""
from __future__ import annotations

import re
import cv2
import numpy as np
import pytesseract

PRICE_RE = re.compile(r"^1[.,][0-9]{5,6}$")


def read_orange_price(payload: bytes) -> tuple[str | None, float, str]:
    arr = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        return None, 0.0, "IMAGE_DECODE_FAILED"
    h, w = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # Orange UI badge; search the right half only, then rank plausible wide contours.
    mask = cv2.inRange(hsv, np.array([5, 110, 100]), np.array([28, 255, 255]))
    mask[:, : int(w * 0.55)] = 0
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = cw * ch
        ratio = cw / max(ch, 1)
        if area < max(180, w * h * 0.00012) or area > w * h * 0.025:
            continue
        if not (2.0 <= ratio <= 6.5) or x < w * 0.60:
            continue
        candidates.append((area, x, y, cw, ch))
    candidates.sort(reverse=True)
    for _, x, y, cw, ch in candidates[:8]:
        # Include a margin: orange contour may omit leading dark digits and decimal.
        pad_x, pad_y = max(12, int(cw * 0.20)), max(6, int(ch * 0.30))
        crop = image[max(0, y-pad_y):min(h, y+ch+pad_y), max(0, x-pad_x):min(w, x+cw+pad_x)]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        text = pytesseract.image_to_string(
            gray, config="--psm 7 -c tessedit_char_whitelist=0123456789.,"
        ).strip().replace(" ", "")
        match = re.search(r"1[.,][0-9]{5,6}", text)
        if match:
            value = match.group(0).replace(",", ".")
            if PRICE_RE.fullmatch(value):
                return value, 0.75, f"ORANGE_BADGE:{x},{y},{cw},{ch}"
    return None, 0.0, "ORANGE_BADGE_NOT_FOUND"
