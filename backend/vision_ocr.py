"""OCR for user-supplied, pre-cropped price-tag images. No directional engine is enabled."""
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


# The client sends an image already cropped around the price tag.
OCR_UPSCALE = 6.0
OCR_CONFIG = "--oem 3 --psm 11 -c tessedit_char_whitelist=0123456789."

_PRICE_RE = re.compile(r"(?<!\d)(\d+\.\d{4,6})(?!\d)")


def parse_price_candidates(text: str) -> tuple[str, ...]:
    """Return only complete decimal prices with four to six fractional digits."""
    cleaned = (
        text.replace("O", "0").replace("o", "0")
        .replace("I", "1").replace("l", "1")
    )
    return tuple(dict.fromkeys(_PRICE_RE.findall(cleaned)))


def read_orange_price(image_bytes: bytes) -> PriceRead:
    """OCR the complete user-cropped price-tag image directly."""
    stage = "decode"
    try:
        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if frame is None or frame.size == 0:
            return PriceRead("INVALID_IMAGE", None, (), "Server could not decode the uploaded image")

        height, width = frame.shape[:2]
        if width < 30 or height < 12:
            return PriceRead(
                "IMAGE_TOO_SMALL", None, (),
                f"Pre-cropped price-tag image is too small ({width}x{height})",
                frame_width=width, frame_height=height,
            )

        # Client defines the crop; OCR the entire uploaded image directly.
        stage = "direct_user_crop"
        tag = frame
        box = (0, 0, width, height)
        logger.info(
            "OCR_USER_CROP frame_wh=%sx%s crop_wh=%sx%s source=client_pre_cropped",
            width, height, width, height,
        )

        stage = "opencv_ocr_preprocessing"
        gray = cv2.cvtColor(tag, cv2.COLOR_BGR2GRAY)

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

        logger.info(
            "OCR_USER_CROP_DIAG crop_wh=%sx%s gray_stats=%s gray_sample=%s",
            width, height, image_stats(gray),
            gray[::max(1, gray.shape[0] // 8), ::max(1, gray.shape[1] // 12)].tolist(),
        )

        # Upscale the fixed crop directly. PSM 11 treats the tag-zone as a
        # sparse-text region, allowing the price to sit anywhere in the box.
        enlarged_gray = cv2.resize(
            gray, None, fx=OCR_UPSCALE, fy=OCR_UPSCALE,
            interpolation=cv2.INTER_CUBIC,
        )
        clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
        enhanced = clahe.apply(enlarged_gray)
        # Five grayscale-only variants; no color conversion or color mask.
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
        blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.2)
        sharpened = cv2.addWeighted(enhanced, 1.6, blurred, -0.6, 0)
        _, sharpened_otsu = cv2.threshold(
            sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )

        variants = (
            ("raw_gray_otsu", raw_otsu),
            ("clahe_otsu", clahe_otsu),
            ("clahe_inverted_otsu", cv2.bitwise_not(clahe_otsu)),
            ("clahe_adaptive", clahe_adaptive),
            ("sharpened_gray_otsu", sharpened_otsu),
        )

        logger.info(
            "OCR_PREPROCESS_DIAG crop_wh=%sx%s upscaled=%sx%s "
            "gray_stats=%s enhanced_stats=%s variants=%s",
            tag.shape[1], tag.shape[0],
            enhanced.shape[1], enhanced.shape[0],
            image_stats(gray), image_stats(enhanced),
            ",".join(name for name, _ in variants),
        )

        stage = "tesseract"
        config = OCR_CONFIG
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
                "OCR_TESSERACT_DIAG variant=%s psm=11 input_wh=%sx%s "
                "input_stats=%s text=%r",
                variant_name, variant_image.shape[1], variant_image.shape[0],
                image_stats(variant_image), recognized[:160],
            )

        raw_text = " | ".join(labeled_texts)

        if len(found_prices) == 1:
            return PriceRead(
                "SUCCESS", found_prices[0], tuple(found_prices),
                "One validated price candidate extracted from the user-supplied crop",
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
            "User-supplied crop processed but no valid price text was recognized",
            box, raw_text, True, width, height,
        )

    except Exception:
        logger.exception("OCR_PIPELINE_ERROR stage=%s", stage)
        raise
