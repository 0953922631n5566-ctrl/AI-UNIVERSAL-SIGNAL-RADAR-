# OCR implementation progress — 2026-11-03

Branch: `feature/xiaomi11t-8xtrade-ocr-nonotc`

## Changes committed
- Android MainActivity stores the bearer token in app-private SharedPreferences and passes it to the foreground capture service; the token is not hard-coded in source.
- Android CaptureService reads MediaProjection frames, JPEG-compresses them, and POSTs multipart data to `/v1/frame` with bearer authorization, session ID, sequence, timestamp, and dimensions.
- Backend extracts the orange floating quote badge using OpenCV and Tesseract. It returns candidate prices only and keeps all directional decisions STANDBY.
- Dedicated Render service: `ai-signal-radar-ocr-api`, service ID `srv-dbkul22jnfac73a0pm8g`, URL `https://ai-signal-radar-ocr-api.onrender.com`, Singapore Free plan.
- Earlier Render deploy `dep-dbkul5k830cc73f7tb50` for commit `e510945175f88aa1b79a7952b9cedebb7c1f3f0f` was verified LIVE.
- Android workflow run `41650575416` completed SUCCESS. APK SHA-256: `539d64b63f6ff8066298ab69525ec33d672fe13c2a19900d88a52f602f1e3947`. APK is a debug build.
- User's Xiaomi screenshot showed successful frame upload through sequence 21, while backend reported `ORANGE_BADGE_NOT_FOUND`. This verifies repeated frame upload from the device before the OCR fix, not successful OCR on that live frame.

## 2026-11-03 live screenshot OCR fix
- Updated `backend/vision_ocr.py` to isolate near-white quote digits in HSV before Tesseract, with grayscale fallback, larger crop padding, 4x enlargement, and multiple page segmentation modes.
- Fixture: user-provided screenshot, 1536x691. Orange badge contour detected at bbox `1233,468,117,32`.
- Exact committed algorithm was reproduced locally with OpenCV 4.13.0 and Tesseract 5.5.0; it returned exactly `1.118665`, matching the visible orange quote badge.
- OCR code commit: `048c712649642671896209cb8809a0446c3a8165`.
- Render build/deploy for the OCR code commit succeeded. A later documentation-only commit `1141e0a0a5783b35cd71ab824225c27d3082fe89` was also deployed successfully; latest deploy `dep-dbkusqk3a9gc73farm0g` status `live` at 2026-11-03 14:24:21 UTC. Because it is a later commit on the same branch, it includes the OCR code fix.
- Live `/health` rechecked after deployment and returned `{"ok":true,"service":"ai-universal-signal-radar","analysis":"standby-only"}`.
- The local fixture test proves the supplied screenshot can be read by the revised algorithm. It does not prove OCR reliability across changing live frames.

## Current verification status
- Render service details: active, not suspended, branch `feature/xiaomi11t-8xtrade-ocr-nonotc`, URL as above.
- After the latest deploy, no fresh device frame POST has yet been observed in the Render request-log query. The last known device upload evidence remains the earlier sequence 21 screenshot, before the OCR fix.
- User has exhausted image-upload quota for now; continue server-side checks without requesting another screenshot.
- A fresh authenticated `/v1/frame` response after the fix remains unverified. Do not claim live device OCR has passed.

## Not complete / safety gates
- Verify a fresh frame POST returns `PRICE_CANDIDATE_ONLY` with a plausible price from the physical Xiaomi 11T. This may be checked from app status text or server-side telemetry when available; do not require another user image upload.
- Market classification is not implemented. The chart label Digital alone does not prove NON-OTC.
- No OHLC candle builder, EMA/RSI/MACD readiness gates, trend-following signal engine, or Mini App signal integration is complete.
- Backend must remain STANDBY unless market type, fresh price stream, and sufficient validated candle history are confirmed. No automatic broker order placement.
- Preserve the separate production main-market service; all OCR work remains on this feature branch and dedicated OCR service.
- Do not store the Render bearer token in Git or documentation.
