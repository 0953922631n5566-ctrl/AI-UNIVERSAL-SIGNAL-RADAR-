# OCR implementation progress — 2026-11-03

Branch: `feature/xiaomi11t-8xtrade-ocr-nonotc`

## Changes committed
- Android MainActivity now has a password-style field for the backend bearer token. It is saved in app-private SharedPreferences and passed to the foreground capture service; it is not hard-coded into source.
- Android CaptureService was extended to read MediaProjection frames, JPEG-compress them, and POST multipart form data to `/v1/frame` with bearer authorization, session ID, monotonic sequence, capture timestamp, and dimensions. It reports upload responses/errors in the app.
- Backend now has an orange-badge OCR helper using OpenCV color/contour detection and Tesseract OCR. It searches orange candidates in the right portion of the screenshot and accepts only EUR/USD-like 1.x decimal strings with 5–6 fractional digits.
- Backend requirements include OpenCV, NumPy, and pytesseract. A Dockerfile installs the Tesseract executable.
- Backend response is designed to expose a price candidate only and remain STANDBY because NON-OTC market classification and candle history are not verified.

## Not complete / not verified
- The Android service still needs a real build and device test. In particular, verify ImageReader row-stride handling, frame cadence, memory use, and network retry behavior on Xiaomi 11T.
- The Android BuildConfig backend URL is still a placeholder and must be changed to the deployed OCR service URL before APK build.
- The OCR backend has not yet been deployed to Render; no ingest token has been configured. Do not put a token in Git or APK source. Set the same strong secret as Render env var `RADAR_INGEST_TOKEN` and in the app's token field.
- The OCR candidate reader needs fixture tests using portrait and landscape Xiaomi screenshots; current confidence is a provisional constant, not calibrated statistical confidence.
- Market-type detection is not implemented. The supplied chart says "Digital"; this does not prove NON-OTC. Keep directional output disabled.
- No OHLC candle builder, EMA/RSI/MACD readiness gate, trend-following signal engine, Mini App integration, or installable verified APK is complete.

## Safe operating state
All backend frame decisions remain STANDBY. The image OCR is a candidate-extraction step only. Do not use a price candidate as a live signal or enter a trade based on this build.
