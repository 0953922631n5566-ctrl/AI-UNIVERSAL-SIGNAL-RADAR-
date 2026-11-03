# AI Universal Signal Radar

This repository contains two separate tracks. Keep the working Main Market web app intact while the standalone Android capture app is developed additively.

## Main Market web app

Single-market signal dashboard for **EUR/USD, 1-minute candles**.

### Two independent analysis engines

- **Closed-candle confirmation:** Twelve Data REST `/time_series`, completed M1 bars only, EMA(5/20), Wilder-smoothed RSI(14). Historical refresh remains capped at 120 seconds to protect the REST API quota.
- **Live next-candle estimate:** One server-side Twelve Data `/quotes/price` WebSocket subscription for EUR/USD. The engine combines the latest WebSocket price with completed-bar history and compares consecutive price updates. It is used internally for confirmation and is never shown as a second signal screen.
- Live output is forced to STANDBY if the subscription is not authorized, no fresh price update arrives within 75 seconds, or the history baseline is incomplete.
- **Two-horizon forecast:** the live engine independently evaluates NEXT M1 and FOLLOWING M1 using EMA(5/20), RSI(14), MACD(12/26/9), candle structure, EMA slope, multi-candle movement, and live momentum. Each horizon requires at least 5 of 6 checks to agree; otherwise it is STANDBY. At least 35 completed candles and a fresh authorized quote are required.
- The displayed 5/6 or 83/100 value is a rule-agreement score, NOT a probability or measured win rate. Predictive accuracy remains unverified pending chronological out-of-sample testing. See [TWO_CANDLE_FORECAST.md](TWO_CANDLE_FORECAST.md).
- **Single unified output:** the REST closed-candle engine and live WebSocket estimate are combined internally. The Mini App shows only one CALL/PUT/STANDBY lamp; it does not display a separate live prediction panel. CALL/PUT final alerts require both engines to agree (quote age <= 75 seconds). A mismatch or stale quote remains STANDBY.
- This is a rule-based estimate, not a trained machine-learning model or a chart-vision model. Validate the next candle after close and measure accuracy before relying on it.
- Manual decision support only; no broker orders are placed.

### Live price display and stale-data guard

- The main price label uses the latest EUR/USD WebSocket quote from `/api/live`, not the REST candle close.
- The UI shows the WebSocket quote timestamp and its live age. If the stream is not subscribed, the timestamp is missing/invalid, or the quote is older than 75 seconds, the live price is shown as STALE (no old REST value is substituted).
- The REST `/api/signal` close remains visible separately as **LAST CLOSED M1** and continues to supply closed-candle analysis.
- The client-side final-alert confirmation also checks the actual age of the WebSocket timestamp, so a quote that ages past 75 seconds cannot continue confirming CALL/PUT.
- This separates display freshness from provider-to-broker price differences; it does not guarantee an exact match with a broker feed or improve predictive accuracy by itself.

### Fixed alert behavior

Read [ALERT_CONFIGURATION.md](ALERT_CONFIGURATION.md) before changing alert code. It is the source of truth and must be preserved unless the user explicitly changes it.

- 10 seconds before each M1 boundary: preparation sound/vibration alert, even if the current decision is STANDBY.
- 5 seconds before each M1 boundary: final result must announce exactly CALL, PUT, or STANDBY; STANDBY also triggers the configured alert.
- Every final result and its illuminated radar state remain visible for exactly 35 seconds from the final notification timestamp, independent of the M1 candle boundary; then the display resets to STANDBY.
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


## Single-horizon signal policy (2026-11-03)

- The only directional forecast is **NEXT M1**: the next one-minute candle.
- The former FOLLOWING M1 horizon and the former REST EMA/RSI directional signal have been removed from the decision path.
- REST Twelve Data is now used only to maintain completed candle history and verify data freshness; it does not produce a competing CALL/PUT direction.
- The single NEXT M1 forecast uses the existing EMA5/EMA20, MACD(12,26,9), RSI(14), last completed candle body, and live momentum rules. Existing 5-of-6 threshold is retained.
- The final alert uses the NEXT M1 forecast directly when REST history is healthy and the WebSocket quote timestamp is no older than 75 seconds. No second directional engine must agree.
- If history/feed is stale, the quote is missing, or the forecast does not pass its rules, the final result remains STANDBY. No fabricated CALL/PUT and no automatic orders.
- The 10-second preparation alert, final 5-second result, 35-second hold, sound/vibration behavior, and manual-only operation remain unchanged.


## Closed-candle-only M1 decision engine — 2026-11-03

- The only directional decision is calculated from fully completed EUR/USD M1 OHLC candles. The live WebSocket quote is display-only and never enters CALL/PUT calculations.
- The forecast uses EMA(5/20), MACD(12/26/9), RSI(14), and the latest completed candle body; at least 5 of 6 rule checks are required.
- Each decision is keyed to the latest completed candle and applies to the immediately following M1 candle only. A newly completed candle triggers a fresh decision; stale closed-candle data returns STANDBY.
- Server history refresh is aligned just after each UTC M1 boundary, at one Twelve Data REST request per minute (up to 1,440 requests/day). The user's provider quota may be exhausted; the service fails safe to STANDBY when data cannot be refreshed.
- The Mini App polls the server cache every 5 seconds; it does not make a Twelve Data request for every browser poll.
- The 10-second preparation reminder remains before each minute boundary. The final result is published 5 seconds after the new candle begins, so the just-closed candle's decision is announced for the candle it actually applies to. CALL/PUT/STANDBY remain visible for 35 seconds.
- This project is one Main Market EUR/USD NON-OTC Mini App. There is no OTC mode, no second horizon, and no automatic broker execution.


## Latest M1 timing and trend guard correction (branch validation pending)

- The Mini App no longer waits for a fixed +5-second result timer. It polls the cached live forecast every 500 ms and publishes as soon as a fresh forecast's `nextCandleAt` matches the current minute. If no exact, fresh result arrives within 12 seconds, it publishes STANDBY once instead of a late CALL/PUT.
- Starting scan mid-minute waits for the next minute boundary.
- The forecast still uses the existing EMA5/EMA20, RSI14, MACD12/26/9, 35 closed-candle warm-up, and 5-of-6 threshold. It now requires EMA trend and latest completed candle body to agree: CALL = UPTREND + bullish candle; PUT = DOWNTREND + bearish candle. Otherwise STANDBY.
- The UI separately displays EMA market trend, latest closed candle direction, and RSI14.
- The forming candle is not treated as confirmed before it closes. REST still refreshes just after each minute boundary, so exact zero-latency is not guaranteed; provider/network response time remains a constraint.
- Changes are on `fix/early-m1-alert-candle-trend`; not merged or deployed yet. Run `npm test` and verify Render + Telegram Mini App before production use.
