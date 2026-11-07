# OTC Vision OCR — Bicubic Preprocessing Patch

**Branch:** `feature/otc-vision-apk`  
**Status:** patch committed; CI build passed (11/11 parser tests); Xiaomi 11T field validation pending.

## Patch contents
- Exact 2x bicubic (Catmull-Rom) scaling of each anchored orange-tag crop.
- Adaptive polarity detection supports both light and dark quote glyphs.
- Orange background mapped to white; local adaptive threshold and contrast enhancement create black glyphs on white for ML Kit.
- Strict post-OCR sanitizer retains only `[0-9.]+` after comma and common glyph-confusion normalization.
- ML Kit Text Recognition has no configurable character whitelist; no unsupported API is claimed.
- On invalid/no-unique quote or OCR failure, up to five preprocessed PNG snapshots per capture are saved locally, best-effort, without allowing file errors to stop capture.
- Parser tests cover strict sanitization and common OCR noise.

## Device validation still required
- Build success does not demonstrate OCR improvement.
- Install new APK on Xiaomi 11T and run 100 consecutive samples with a visible quote tag.
- Review extraction rate, exact-match rate against timestamp-matched ground truth, OCR/frame latency, heap, Android thermal status and battery temperature separately.
- If `NO_VALID_PRICE` remains, inspect PNG snapshots under app-specific `Pictures/ocr-debug` and share them with the matching CSV.

## Isolation
No network, backend, Render, Twelve Data, Firebase, FCM, Telegram, broker execution, or Main Market source is changed.
