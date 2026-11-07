"""Server-side fixed right-axis ROI price OCR. No directional engine is enabled."""
from __future__ import annotations

import base64
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
    """Crop the fixed right-axis zone and OCR its displayed price."""
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

        # Fixed right-axis ROI: capture the complete price-axis column between
        # the chart's right edge and the trade-control column. Coordinates are
        # normalized to the incoming frame, so the same layout works at
        # different Android screenshot resolutions. No color/contour detection
        # is used to determine the crop.
        stage = "fixed_right_axis_roi"
        roi_left_ratio = 0.68
        roi_right_ratio = 0.90
        roi_top_ratio = 0.35
        roi_bottom_ratio = 0.65
        left = max(0, min(width - 1, int(round(width * roi_left_ratio))))
        right = max(left + 1, min(width, int(round(width * roi_right_ratio))))
        top = max(0, min(height - 1, int(round(height * roi_top_ratio))))
        bottom = max(top + 1, min(height, int(round(height * roi_bottom_ratio))))
        tag = frame[top:bottom, left:right]
        box = (left, top, right, bottom)

        if tag.size == 0:
            return PriceRead(
                "INVALID_AXIS_ROI", None, (),
                "Fixed right-axis ROI is empty",
                box, "", False, width, height,
            )

        crop_w, crop_h = tag.shape[1], tag.shape[0]
        min_crop_w = max(80, int(round(width * 0.075)))
        min_crop_h = max(24, int(round(height * 0.018)))
        roi_gray = cv2.cvtColor(tag, cv2.COLOR_BGR2GRAY)
        roi_mean_brightness = round(float(roi_gray.mean()), 2)
        roi_p90_brightness = round(float(np.percentile(roi_gray, 90)), 2)
        logger.info(
            "FIXED_RIGHT_AXIS_ROI box=%s crop_wh=%sx%s "
            "ratios=(%.3f,%.3f,%.3f,%.3f) frame_wh=%sx%s "
            "gray_mean=%.2f gray_p90=%.2f valid=%s",
            box, crop_w, crop_h,
            roi_left_ratio, roi_top_ratio, roi_right_ratio, roi_bottom_ratio,
            width, height, roi_mean_brightness, roi_p90_brightness,
            crop_w >= min_crop_w and crop_h >= min_crop_h,
        )
        if crop_w < min_crop_w or crop_h < min_crop_h:
            return PriceRead(
                "AXIS_ROI_TOO_SMALL", None, (),
                f"Fixed right-axis ROI is below minimum dimensions "
                f"({crop_w}x{crop_h}; required at least "
                f"{min_crop_w}x{min_crop_h})",
                box, "", False, width, height,
            )

        stage = "opencv_ocr_preprocessing"
        gray = cv2.cvtColor(tag, cv2.COLOR_BGR2GRAY)
        hsv_tag = cv2.cvtColor(tag, cv2.COLOR_BGR2HSV)

        # Preserve the source crop and inspect whether bright, low-saturation
        # digit pixels are present before any contrast/threshold operation.
        def image_stats(image: np.ndarray) -> dict:
            arr = np.asarray(image)
            return {
                "shape": tuple(int(v) for v in arr.shape),
                "dtype": str(arr.dtype),
                "min": int(arr.min()),
                "max": int(arr.max()),
                "mean": round(float(arr.mean()), 2),
                "std": round(float(arr.std()), 2),
                "p10": round(float(np.percentile(arr, 10)), 2),
                "p50": round(float(np.percentile(arr, 50)), 2),
                "p90": round(float(np.percentile(arr, 90)), 2),
            }

        white_text_mask = cv2.inRange(
            hsv_tag,
            np.array([0, 0, 145], dtype=np.uint8),
            np.array([179, 135, 255], dtype=np.uint8),
        )
        logger.info(
            "OCR_TAG_CROP_DIAG frame_wh=%sx%s tag_box=%s crop_wh=%sx%s "
            "bgr_stats=%s gray_stats=%s hsv_stats=%s white_mask_pixels=%s "
            "white_mask_ratio=%.5f gray_sample=%s",
            width, height, box, tag.shape[1], tag.shape[0],
            image_stats(tag), image_stats(gray), image_stats(hsv_tag),
            int(cv2.countNonZero(white_text_mask)),
            cv2.countNonZero(white_text_mask) / max(1, white_text_mask.size),
            gray[::max(1, gray.shape[0] // 8), ::max(1, gray.shape[1] // 12)].tolist(),
        )

        enlarged_gray = cv2.resize(
            gray, None, fx=6.0, fy=6.0, interpolation=cv2.INTER_CUBIC
        )
        clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
        enhanced = clahe.apply(enlarged_gray)
        enlarged_white_mask = cv2.resize(
            white_text_mask, (enhanced.shape[1], enhanced.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        )

        # Keep a non-thresholded grayscale path, a gentler CLAHE path, and
        # a color-derived white-glyph mask. The mask is supplemental: it never
        # replaces grayscale inputs, so low-contrast digits are not discarded.
        _, raw_otsu = cv2.threshold(
            enlarged_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        _, clahe_otsu = cv2.threshold(
            enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        clahe_adaptive = cv2.adaptiveThreshold(
            enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 31, 5,
        )
        white_mask_variant = cv2.morphologyEx(
            enlarged_white_mask, cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
            iterations=1,
        )

        variants = (
            ("raw_gray_otsu", raw_otsu),
            ("clahe_otsu", clahe_otsu),
            ("clahe_inverted_otsu", cv2.bitwise_not(clahe_otsu)),
            ("clahe_adaptive", clahe_adaptive),
            ("white_text_mask", white_mask_variant),
        )

        logger.info(
            "OCR_PREPROCESS_DIAG tag_box=%s crop_wh=%sx%s upscaled=%sx%s "
            "gray_stats=%s enhanced_stats=%s variants=%s",
            box, tag.shape[1], tag.shape[0],
            enhanced.shape[1], enhanced.shape[0],
            image_stats(gray), image_stats(enhanced),
            ",".join(name for name, _ in variants),
        )

        stage = "tesseract"
        config = (
            "--oem 3 --psm 7 "
            "-c tessedit_char_whitelist=0123456789."
        )
        labeled_texts: list[str] = []
        found_prices: list[str] = []

        # PNG/base64 is lossless and represents the exact pixel array passed
        # to Tesseract. These are tightly bounded tag crops, not full frames.
        def log_exact_ocr_image(label: str, image: np.ndarray) -> None:
            ok, encoded_png = cv2.imencode(
                ".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 3]
            )
            if not ok:
                logger.warning("OCR_IMAGE_DIAG_ENCODE_FAILED variant=%s", label)
                return
            payload = base64.b64encode(encoded_png.tobytes()).decode("ascii")
            logger.info(
                "OCR_IMAGE_DIAG variant=%s width=%s height=%s stats=%s "
                "png_base64=%s",
                label, image.shape[1], image.shape[0],
                image_stats(image), payload,
            )

        # Log the original crop and every exact preprocessed image supplied
        # to Tesseract. Render logs can therefore reconstruct the OCR inputs.
        log_exact_ocr_image("tag_crop_bgr", tag)
        for variant_name, variant_image in variants:
            log_exact_ocr_image(variant_name, variant_image)

        for variant_name, variant_image in variants:
            recognized = pytesseract.image_to_string(
                variant_image, config=config
            ).strip()
            labeled_texts.append(f"{variant_name}={recognized!r}")
            for price in parse_price_candidates(recognized):
                if price not in found_prices:
                    found_prices.append(price)
            logger.info(
                "OCR_TESSERACT_DIAG variant=%s psm=7 input_wh=%sx%s "
                "input_stats=%s text=%r",
                variant_name, variant_image.shape[1], variant_image.shape[0],
                image_stats(variant_image), recognized[:160],
            )

        raw_text = " | ".join(labeled_texts)

        if len(found_prices) == 1:
            return PriceRead(
                "SUCCESS", found_prices[0], tuple(found_prices),
                "One validated price candidate extracted from fixed right-axis ROI",
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
            "Fixed right-axis ROI captured but no valid price text was recognized",
            box, raw_text, True, width, height,
        )

    except Exception:
        logger.exception("OCR_PIPELINE_ERROR stage=%s", stage)
        raise
