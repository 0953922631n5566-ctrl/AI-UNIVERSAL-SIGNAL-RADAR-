# Universal Broker Vision AI

Isolated Android screen-capture and visual market-observation project. It does not modify the production Main Market service and never submits broker orders.

## Architecture
- Android MediaProjection foreground service captures a user-approved screen session.
- Google ML Kit Text Recognition extracts visible text and price-like values.
- A pixel pass segments green/red candle bodies and estimates wick bounds from the chart area.
- The app reads visible price-axis labels and the live price tag; when at least two reliable price/vertical-axis points exist, the API maps candle pixels to approximate OHLC price levels.
- Instrument and timeframe histories are isolated so switching pairs does not mix price momentum.
- The client posts only chart-region OCR text, detected price, pair/timeframe labels, and candle geometry to a separate Node API. Raw screenshots are processed locally and are not uploaded; account balance and side-panel text are excluded from OCR uploads.
- The API returns CALL / PUT / WAIT diagnostics and fails closed when visual data is incomplete.

## Limitations
This is an initial prototype, not a validated trading system. OCR and candle segmentation need calibration across broker layouts, themes, zoom levels, and rotations. Pixel colors and OCR are imperfect. OHLC levels are approximate and only available when the visible price axis can be calibrated. If symbol/timeframe cannot be identified, or the chart is too unclear, the engine returns WAIT. The score is not a win probability. No profitability claim is made.
Android requires explicit screen-capture approval for each session and shows a persistent foreground notification. A signed APK must be built and installed on the Xiaomi 11T; a repository commit does not install software on the phone.

## API
Set VISION_API_TOKEN on the host. Endpoints: GET /health, POST /api/vision/frame, GET /api/vision/status, GET /api/vision/snapshot. Authenticated routes use Authorization: Bearer token.

## Build
Open broker-vision/android in Android Studio with JDK 17 and Android SDK 35. Build the app APK, install it, enter the deployed HTTPS API URL and token, tap Start Capture, approve screen capture, then switch to the broker platform.

## Validation gates
1. Build APK and pass Android compile/lint.
2. Deploy API and verify health and authenticated frame ingestion.
3. Replay supplied screenshot and real screen layouts; calibrate OCR and candle extraction.
4. Compare extracted observations with visible broker values.
5. Collect replay data and measure out-of-sample behavior before using signals for financial decisions.