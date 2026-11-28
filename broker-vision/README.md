# Universal Broker Vision AI

Isolated Android screen-capture and visual market-observation project. It does not modify the production Main Market service and never submits broker orders.

## Architecture
- Android MediaProjection foreground service captures a user-approved screen session.
- Google ML Kit Text Recognition extracts visible text and price-like values.
- A pixel pass segments green/red candle bodies and estimates wick bounds from the chart area.
- The app reads visible price-axis labels and the live price tag; when at least two reliable price/vertical-axis points exist, the API maps candle pixels to approximate OHLC price levels.
- The signal engine does not require an instrument name or timeframe. It analyzes visible numeric prices; a sudden price-scale discontinuity above 5% starts a fresh sample window to reduce mixing data when the user switches charts.
- The client posts chart-region OCR text, detected price, pair/timeframe labels, candle geometry, and a compressed JPEG crop of the chart to a separate Node API. It does not intentionally upload the full screen; the crop excludes the outer account side panels, but users should still avoid displaying sensitive account details inside the chart crop.
- The API returns CALL / PUT / WAIT diagnostics and fails closed when visual data is incomplete.

## Limitations
This is an initial prototype, not a validated trading system. OCR and candle segmentation need calibration across broker layouts, themes, zoom levels, and rotations. Pixel colors and OCR are imperfect. OHLC levels are approximate and only available when the visible price axis can be calibrated. If the current price cannot be read, fewer than two consecutive samples are available, net movement is below one tick, or directional consistency is below 60%, the engine returns WAIT. There is no score threshold. No profitability claim is made.
Android requires explicit screen-capture approval for each session and shows a persistent foreground notification. A signed APK must be built and installed on the Xiaomi 11T; a repository commit does not install software on the phone.

## API
Set VISION_API_TOKEN on the host. Set VISION_DEMO_ENROLLMENT=true only while temporary device enrollment is required; enrollment is IP-rate-limited and device tokens expire after 24 hours. Endpoints: GET /health, POST /api/vision/enroll, POST /api/vision/frame, GET /api/vision/status, GET /api/vision/snapshot, GET /api/vision/public. Authenticated routes use Authorization: Bearer token. Frame uploads must include a valid JPEG in imageBase64; the public dashboard shows the latest uploaded chart crop. Set VISION_STORAGE_DIR to a mounted persistent-disk path to retain the latest JPEG and metadata across restarts. Without a persistent disk, the latest image and frame history remain in memory and are lost on restart.

## Build
Open broker-vision/android in Android Studio with JDK 17 and Android SDK 35. Build the app APK, install it, enter the deployed HTTPS API URL, tap Start Capture, allow temporary device enrollment, approve screen capture, then switch to the broker platform.

## Validation gates
1. Build APK and pass Android compile/lint.
2. Deploy API and verify health and authenticated frame ingestion.
3. Replay supplied screenshot and real screen layouts; calibrate OCR and candle extraction.
4. Compare extracted observations with visible broker values.
5. Collect replay data and measure out-of-sample behavior before using signals for financial decisions.