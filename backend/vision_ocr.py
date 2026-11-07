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


_PRICE_RE = re.compile(r"(?<!\d)(\d+\.\d{4,6})(?!\d)")


def parse_price_candidates(text: str) -> tuple[str, ...]:
    """Return only complete decimal prices with four to six fractional digits."""
    cleaned = (
        text.replace("O", "0").replace("o", "0")
        .replace("I", "1").replace("l", "1")
    )
    return tuple(dict.fromkeys(_PRICE_RE.findall(cleaned)))


def read_orange_price(image_bytes: bytes) -> PriceRead:
    """Detect and OCR a compact orange price tag on the chart's right axis."""
    stage = "decode"
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

        # Search a broader right-side chart region. Live platforms can place
        # the price tag at different vertical levels and slightly left of the
        # screen edge; full-width banners remain excluded by contour geometry.
        stage = "opencv_orange_mask"
        x0, x1 = int(width * 0.65), width
        y0, y1 = int(height * 0.05), int(height * 0.90)
        axis = frame[y0:y1, x0:x1]
        if axis.size == 0:
            return PriceRead(
                "INVALID_AXIS_ROI", None, (), "Right-axis ROI is empty",
                frame_width=width, frame_height=height,
            )

        hsv = cv2.cvtColor(axis, cv2.COLOR_BGR2HSV)
        orange_mask = cv2.inRange(
            hsv, np.array([4, 75, 70]), np.array([38, 255, 255])
        )
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        orange_mask = cv2.morphologyEx(
            orange_mask, cv2.MORPH_CLOSE, kernel, iterations=2
        )
        contours, _ = cv2.findContours(
            orange_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        axis_h, axis_w = axis.shape[:2]
        axis_area = max(1, axis_h * axis_w)
        tag_candidates: list[tuple[float, int, int, int, int]] = []

        # Emit geometry and orange-pixel coverage before applying any filter.
        # This makes rejected contours inspectable from Render logs.
        contour_diagnostics: list[tuple[int, int, int, int, int, float, float]] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = max(1, w * h)
            aspect = w / max(1, h)
            right_edge_ratio = (x + w) / max(1, axis_w)
            roi_mask = orange_mask[y:y + h, x:x + w]
            hsv_coverage = cv2.countNonZero(roi_mask) / area
            contour_diagnostics.append(
                (area, x, y, w, h, aspect, hsv_coverage)
            )

        for index, (area, x, y, w, h, aspect, hsv_coverage) in enumerate(
            sorted(contour_diagnostics, reverse=True)[:30], start=1
        ):
            right_edge_ratio = (x + w) / max(1, axis_w)
            logger.info(
                "ORANGE_CONTOUR_DIAG index=%s bbox_axis=%s bbox_frame=%s "
                "aspect=%.3f right_edge=%.3f hsv_coverage=%.3f area=%s",
                index, (x, y, w, h),
                (x0 + x, y0 + y, w, h),
                aspect, right_edge_ratio, hsv_coverage, area,
            )

        for area, x, y, w, h, aspect, hsv_coverage in contour_diagnostics:
            right_edge_ratio = (x + w) / max(1, axis_w)

            # Relaxed tag geometry: allow tags that sit farther left or higher
            # on the axis, and support shorter/wider and taller/narrower labels.
            # Very wide or tall contours remain excluded to reject warning bars.
            if x < int(axis_w * 0.04) or right_edge_ratio < 0.76:
                continue
            if w < max(18, int(axis_w * 0.045)) or w > int(axis_w * 0.70):
                continue
            if h < max(8, int(axis_h * 0.004)) or h > int(axis_h * 0.12):
                continue
            if aspect < 1.35 or aspect > 18.0:
                continue
            if area < axis_area * 0.00004 or area > axis_area * 0.085:
                continue

            # Prefer compact, orange-dense contours near the right edge.
            score = (
                area * (0.45 + right_edge_ratio)
                * min(aspect, 9.0) * max(0.25, hsv_coverage) / 4.0
            )
            tag_candidates.append((score, x, y, w, h))

        if not tag_candidates:
            return PriceRead(
                "ORANGE_TAG_NOT_FOUND", None, (),
                "No compact orange price tag matched the strict right-axis geometry",
                frame_width=width, frame_height=height,
            )

        _, x, y, w, h = max(tag_candidates, key=lambda item: item[0])

        # Pad around the entire detected tag so leading digits and decimal
        # points are not clipped by a tight contour boundary.
        pad_x = max(5, int(round(w * 0.15)))
        pad_y = max(5, int(round(h * 0.25)))
        left = max(0, x0 + x - pad_x)
        top = max(0, y0 + y - pad_y)
        right = min(width, x0 + x + w + pad_x)
        bottom = min(height, y0 + y + h + pad_y)
        tag = frame[top:bottom, left:right]
        box = (left, top, right, bottom)

        if tag.size == 0:
            return PriceRead(
                "INVALID_TAG_CROP", None, (), "Detected tag crop is empty",
                box, "", True, width, height,
            )

        stage = "opencv_ocr_preprocessing"
        gray = cv2.cvtColor(tag, cv2.COLOR_BGR2GRAY)
        enlarged = cv2.resize(
            gray, None, fx=4.0, fy=4.0, interpolation=cv2.INTER_CUBIC
        )
        enhanced = cv2.createCLAHE(
            clipLimit=2.0, tileGridSize=(8, 8)
        ).apply(enlarged)

        _, otsu = cv2.threshold(
            enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        inverted_otsu = cv2.bitwise_not(otsu)
        adaptive = cv2.adaptiveThreshold(
            enhanced, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 31, 7,
        )

        variants = (
            ("otsu", otsu),
            ("inverted_otsu", inverted_otsu),
            ("gaussian_adaptive", adaptive),
        )

        logger.info(
            "OCR_PREPROCESS_DIAG tag_box=%s tag_wh=%sx%s padded_crop=%sx%s "
            "upscaled=%sx%s variants=%s",
            box, w, h, tag.shape[1], tag.shape[0],
            enhanced.shape[1], enhanced.shape[0],
            ",".join(name for name, _ in variants),
        )

        stage = "tesseract"
        config = (
            "--oem 3 --psm 7 "
            "-c tessedit_char_whitelist=0123456789."
        )
        labeled_texts: list[str] = []
        found_prices: list[str] = []

        for variant_name, variant_image in variants:
            recognized = pytesseract.image_to_string(
                variant_image, config=config
            ).strip()
            labeled_texts.append(f"{variant_name}={recognized!r}")
            for price in parse_price_candidates(recognized):
                if price not in found_prices:
                    found_prices.append(price)
            logger.info(
                "OCR_TESSERACT_DIAG variant=%s psm=7 text=%r",
                variant_name, recognized[:160],
            )

        raw_text = " | ".join(labeled_texts)

        if len(found_prices) == 1:
            return PriceRead(
                "SUCCESS", found_prices[0], tuple(found_prices),
                "One validated price candidate extracted from orange tag",
                box, raw_text, True, width, height,
            )
        if len(found_prices) > 1:
            return PriceRead(
                "AMBIGUOUS_PRICE", None, tuple(found_prices),
                "Multiple distinct price candidates detected; no price selected",
                box, raw_text, True, width, height,
            )

        return PriceRead(
            "NO_VALID_PRICE", None, (),
            "Orange tag found but no valid price text was recognized",
            box, raw_text, True, width, height,
        )

    except Exception:
        logger.exception("OCR_PIPELINE_ERROR stage=%s", stage)
        raise
