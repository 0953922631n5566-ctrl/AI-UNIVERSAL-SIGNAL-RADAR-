"""Server-side orange price-tag detection and OCR. No directional engine is enabled."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import cv2
import numpy as np
import pytesseract

logger = logging.getLogger("otc_vision.ocr")


@dataclass(frozen=True)
class PriceRead:
    status: str
    price: str | None
    candidates: tuple[str, ...]
    reason: str
    tag_box: tuple[int, int, int, int] | None = None
    raw_text: str = ""
    orange_tag_found: bool = False
    frame_width: int | None = None
    frame_height: int | None = None


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
    """Detect and OCR a right-axis orange banner using decoded frame dimensions."""
    stage = "decode"
    frame = None
    try:
        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if frame is None or frame.size == 0:
            return PriceRead("INVALID_IMAGE", None, (), "Server could not decode the uploaded image")
        height, width = frame.shape[:2]
        if width < 240 or height < 320:
            return PriceRead(
                "IMAGE_TOO_SMALL", None, (),
                f"Decoded frame is too small ({width}x{height})",
                frame_width=width, frame_height=height,
            )

        # All ROI coordinates are relative to the decoded image, not client metadata.
        stage = "opencv_orange_mask"
        x0, x1 = int(width * 0.72), width
        y0, y1 = int(height * 0.12), int(height * 0.68)
        axis = frame[y0:y1, x0:x1]
        if axis.size == 0:
            return PriceRead(
                "INVALID_AXIS_ROI", None, (), "Right-axis ROI is empty",
                frame_width=width, frame_height=height,
            )
        hsv = cv2.cvtColor(axis, cv2.COLOR_BGR2HSV)
        orange_mask = cv2.inRange(hsv, np.array([4, 75, 70]), np.array([38, 255, 255]))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        orange_mask = cv2.morphologyEx(orange_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(
            orange_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
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
            if aspect < 3.0 or aspect > 14:
                continue
            right_bias = (x + w) / max(1, axis.shape[1])
            score = area * (0.35 + right_bias) * min(aspect, 10.0) / 5.0
            candidates.append((score, x, y, w, h))

        if not candidates:
            return PriceRead(
                "ORANGE_TAG_NOT_FOUND", None, (),
                "No orange price tag was detected on the right axis",
                frame_width=width, frame_height=height,
            )

        _, x, y, w, h = max(candidates, key=lambda item: item[0])
        crop_x = x
        if x <= int(axis.shape[1] * 0.08) and w >= int(axis.shape[1] * 0.35):
            crop_x = x + int(w * 0.48)
        pad_x = max(5, int(w * 0.06))
        pad_y = max(8, int(h * 0.35))
        left = max(0, x0 + crop_x - pad_x)
        top = max(0, y0 + y - pad_y)
        right = min(width, x0 + x + w + pad_x)
        bottom = min(height, y0 + y + h + pad_y)
        tag = frame[top:bottom, left:right]
        box = (left, top, right, bottom)
        if tag.size == 0:
            return PriceRead(
                "INVALID_TAG_CROP", None, (), "Detected tag crop is empty", box, "",
                True, width, height,
            )

        # Exclude the pointed left tip/edge while retaining the banner's digits.
        text_region = tag[:, int(tag.shape[1] * 0.18):max(int(tag.shape[1] * 0.94), 1)]
        if text_region.size == 0:
            text_region = tag

        stage = "opencv_white_text_preprocessing"
        # Relax the white mask to retain anti-aliased digits and slightly tinted whites.
        hsv_text = cv2.cvtColor(text_region, cv2.COLOR_BGR2HSV)
        white_text_mask = cv2.inRange(
            hsv_text, np.array([0, 0, 135]), np.array([179, 180, 255])
        )
        white_text_mask = cv2.morphologyEx(
            white_text_mask, cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)), iterations=1,
        )
        enlarged = cv2.resize(text_region, None, fx=4.0, fy=4.0, interpolation=cv2.INTER_CUBIC)
        enlarged_mask = cv2.resize(white_text_mask, None, fx=4.0, fy=4.0, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
        enhanced = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        otsu_inv = cv2.bitwise_not(otsu)
        adaptive = cv2.adaptiveThreshold(
            enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9
        )
        adaptive_inv = cv2.bitwise_not(adaptive)
        mask_at_ocr_size = cv2.resize(
            white_text_mask, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST
        )
        masked_gray = cv2.bitwise_and(gray, gray, mask=mask_at_ocr_size)
        masked_gray_inv = cv2.bitwise_not(masked_gray)

        def pixel_stats(image: np.ndarray) -> str:
            return (
                f"{image.shape[1]}x{image.shape[0]},min={int(image.min())},"
                f"max={int(image.max())},mean={float(image.mean()):.1f},"
                f"nonzero={100.0*np.count_nonzero(image)/image.size:.1f}%,"
                f"bright={100.0*np.count_nonzero(image >= 200)/image.size:.1f}%"
            )

        logger.info(
            "OCR_PREPROCESS_DIAG tag_box=%s tag_wh=%sx%s text_wh=%sx%s "
            "white_mask=[%s] gray=[%s] otsu=[%s] adaptive=[%s]",
            box, tag.shape[1], tag.shape[0], text_region.shape[1], text_region.shape[0],
            pixel_stats(white_text_mask), pixel_stats(gray), pixel_stats(otsu),
            pixel_stats(adaptive),
        )

        stage = "tesseract"
        variants = (
            ("white_mask", enlarged_mask), ("masked_gray", masked_gray),
            ("masked_gray_inv", masked_gray_inv), ("otsu", otsu),
            ("otsu_inv", otsu_inv), ("adaptive", adaptive),
            ("adaptive_inv", adaptive_inv),
        )
        psm_modes = (7, 8, 13)
        texts: list[str] = []
        labeled_texts: list[str] = []
        try:
            for variant_name, variant_image in variants:
                for psm in psm_modes:
                    config = f"--oem 3 --psm {psm} -c tessedit_char_whitelist=0123456789.,"
                    recognized = pytesseract.image_to_string(variant_image, config=config).strip()
                    texts.append(recognized)
                    logger.info(
                        "OCR_TESSERACT_DIAG variant=%s psm=%s text=%r",
                        variant_name, psm, recognized[:120],
                    )
                    if recognized:
                        labeled_texts.append(f"{variant_name}:psm{psm}={recognized}")
        except Exception:
            logger.exception("OCR_PIPELINE_ERROR stage=tesseract")
            raise

        raw_text = " | ".join(labeled_texts)
        reads = tuple(dict.fromkeys(
            price for raw in texts for price in parse_price_candidates(raw)
        ))
        if len(reads) == 1:
            return PriceRead(
                "PRICE_READ", reads[0], reads,
                "One price candidate extracted from orange tag", box, raw_text,
                True, width, height,
            )
        if len(reads) > 1:
            return PriceRead(
                "AMBIGUOUS_PRICE", None, reads,
                "Multiple price candidates detected; no price selected", box, raw_text,
                True, width, height,
            )
        return PriceRead(
            "NO_VALID_PRICE", None, (),
            "Orange tag found but no valid price text was recognized", box, raw_text,
            True, width, height,
        )
    except Exception:
        logger.exception("OCR_PIPELINE_ERROR stage=%s", stage)
        raise
