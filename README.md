# AI Universal Signal Radar

This repository contains two separate tracks. Keep the working Main Market web app intact while the standalone Android capture app is developed additively.

## Main Market web app

Single-market signal dashboard for **EUR/USD, 1-minute candles**.

### Two independent analysis engines

- **Closed-candle confirmation:** Twelve Data REST `/time_series`, completed M1 bars only, EMA(5/20), Wilder-smoothed RSI(14). Historical refresh remains capped at 120 seconds to protect the REST API quota.
- **Live next-candle estimate:** One server-side Twelve Data `/quotes/price` WebSocket subscription for EUR/USD. The engine combines the latest WebSocket price with completed-bar history and compares consecutive price updates. It is displayed separately and never overwrites the closed-candle result.
- Live output is forced to STANDBY if the subscription is not authorized, no fresh price update arrives within 75 seconds, or the history baseline is incomplete.
- **Entry alert gate:** the main CALL/PUT lamp and sound require both engines to agree on the same direction: a fresh closed-candle result and a fresh WebSocket estimate (quote age <= 75 seconds). A mismatch or stale quote remains STANDBY.
- This is a rule-based estimate, not a trained machine-learning model or a chart-vision model. Validate the next candle after close and measure accuracy before relying on it.
- Manual decision support only; no broker orders are placed.

### Fixed alert behavior

Read [ALERT_CONFIGURATION.md](ALERT_CONFIGURATION.md) before changing alert code. It is the source of truth and must be preserved unless the user explicitly changes it.

- 10 seconds before each M1 boundary: preparation sound/vibration alert, even if the current decision is STANDBY.
- 5 seconds before each M1 boundary: final result must announce exactly CALL, PUT, or STANDBY; STANDBY also triggers the configured alert.
- Every final result remains visible for 35 seconds, then the display resets to STANDBY.
- This is client-side notification/display behavior, not a 5-second market-data confirmation. The WebSocket cadence is approximately one update per minute.
- Basic/Grow plans may not authorize EUR/USD WebSocket access; the live panel must report unavailable rather than fabricate a quote.

### Runtime and deployment

- Node.js 18.x; Express 4, node-fetch 2, ws 8.
- `TWELVE_DATA_API_KEY` is supplied privately through Render environment variables.
- Build: `npm install`; start: `npm start`.
- Main service: https://ai-universal-signal-radar-main.onrender.com

Endpoints:
- `/health`: service status and live stream status
- `/api/signal`: closed-candle signal
- `/api/live`: separate live-price prediction

## Standalone Android APK — in development

The Android project is under `android/`; the frame-ingestion API baseline is under `backend/`. The GitHub Actions workflow `.github/workflows/android-apk.yml` builds a debug APK when Android source or the workflow changes on `main`.

Latest baseline build:
- Workflow: [Android APK Build #41592461418](https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/41592461418)
- Source commit: `ceef0bfb634c29e66b70456e56e4b673c6bd71f4`
- APK SHA-256: `f4cb8a7a6c1865791f9b469277ab781ae9791c6f7064acca73acdd8b9d8784a1`

**Important:** this APK is a debug capture-shell build, not a completed AI scanner. The current Android source starts MediaProjection and creates an ImageReader, but it does not yet encode JPEG frames, upload them over authenticated HTTPS, parse backend decisions, or display backend STANDBY/CALL/PUT with reasons. The backend currently returns STANDBY because no vision adapter is configured, and it is not deployed as a Render service.

Never embed API keys, bearer tokens, or reusable secrets in the APK or public source. Keep all directional output STANDBY until a real perception and decision model has been configured and evaluated. No automated broker execution is allowed.
