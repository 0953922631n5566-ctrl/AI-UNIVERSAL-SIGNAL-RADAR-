# OCR implementation progress — 2026-11-03

Branch: `feature/xiaomi11t-8xtrade-ocr-nonotc`

## Changes committed
- Android MainActivity stores the bearer token in app-private SharedPreferences and passes it to the foreground capture service; the token is not hard-coded in source.
- Android CaptureService reads MediaProjection frames, JPEG-compresses them, and POSTs multipart data to `/v1/frame` with bearer authorization, session ID, sequence, timestamp, and dimensions.
- Backend extracts the orange floating quote badge using OpenCV and Tesseract. It returns candidate prices only and keeps all directional decisions STANDBY.
- Dedicated Render service: `ai-signal-radar-ocr-api`, service ID `srv-dbkul22jnfac73a0pm8g`, URL `https://ai-signal-radar-ocr-api.onrender.com`, Singapore Free plan.
- Render deploy `dep-dbkul5k830cc73f7tb50` for commit `e510945175f88aa1b79a7952b9cedebb7c1f3f0f` was verified LIVE. `/health` returned OK and standby-only.
- Android workflow run `41650575416` completed SUCCESS. APK SHA-256: `539d64b63f6ff8066298ab69525ec33d672fe13c2a19900d88a52f602f1e3947`. APK is a debug build.
- User's Xiaomi screenshot later showed successful frame upload through sequence 21, while backend reported `ORANGE_BADGE_NOT_FOUND`. This verifies repeated frame upload from the device, not successful OCR on that particular live frame.

## 2026-11-03 live screenshot OCR fix
- Updated `backend/vision_ocr.py` to isolate near-white quote digits in HSV before Tesseract, with grayscale fallback, larger crop padding, 4x enlargement, and multiple page segmentation modes.
- Fixture: `/mnt/data/1000639277.jpg`, 1536x691. The orange badge candidate was detected at bbox `1233,468,117,32`.
- Exact committed algorithm was reproduced locally with OpenCV 4.13.0 and Tesseract 5.5.0; it returned exactly `1.118665` (raw OCR `1.118665`, PSM 7). This directly matches the visible orange quote badge.
- Commit containing OCR fix: `048c712649642671896209cb8809a0446c3a8165`.
- This is a successful single-image fixture test. It does not yet prove the live Render deployment has picked up the commit or that OCR is reliable across changing frames.

## Not complete / safety gates
- Verify the Render deploy for commit `048c712649642671896209cb8809a0446c3a8165` reaches LIVE, then verify a fresh frame POST returns `PRICE_CANDIDATE_ONLY` with the expected price.
- Re-test on the physical Xiaomi 11T while 8xTrade EUR/USD Digital is visible. The device upload counter reaching 21 proves frames arrived; it does not prove the last frame OCR read correctly.
- Market classification is not implemented. The chart label Digital alone does not prove NON-OTC.
- No OHLC candle builder, EMA/RSI/MACD readiness gates, trend-following signal engine, or Mini App signal integration is complete.
- Backend must remain STANDBY unless market type, fresh price stream, and sufficient validated candle history are confirmed. No automatic broker order placement.
- Preserve the separate production main-market service; all OCR work remains on this feature branch and dedicated OCR service.
- Do not store the Render bearer token in Git or documentation.
