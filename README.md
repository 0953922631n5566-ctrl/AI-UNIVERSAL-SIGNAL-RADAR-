# AI Universal Signal Radar — Main Market

Single-market signal dashboard for **EUR/USD, 1-minute candles**.

## Two independent analysis engines

- **Closed-candle confirmation:** Twelve Data REST `/time_series`, completed M1 bars only, EMA(5/20), Wilder-smoothed RSI(14). Historical refresh remains capped at 120 seconds to protect the REST API quota.
- **Live next-candle estimate:** One server-side Twelve Data `/quotes/price` WebSocket subscription for EUR/USD. The engine combines the latest WebSocket price with completed-bar history and compares consecutive price updates (Twelve Data documents Forex WebSocket mid-price updates at approximately one-minute cadence). It is displayed separately and never overwrites the closed-candle result.
- Live output is forced to STANDBY if the subscription is not authorized, no fresh price update arrives within 75 seconds, or the history baseline is incomplete.
- **Entry alert gate:** the main CALL/PUT lamp and sound require both engines to agree on the same direction: a fresh closed-candle result and a fresh WebSocket estimate (quote age <= 75 seconds). A mismatch or stale quote remains STANDBY.
- **Pre-entry alerts:** while scanning, the Mini App gives a one-time sound/vibration preparation alert at approximately 10 seconds and a final result alert at approximately 5 seconds before the next M1 boundary. The final 5-second result uses the latest available dual-confirmation state; it is a countdown reminder, not a new tick-level price confirmation.
- **Signal display hold:** a confirmed CALL/PUT or final STANDBY result is held on screen for 35 seconds, then returns to STANDBY while waiting for the next cycle. This is client-side display behavior only.
- The Forex WebSocket feed is approximately one update per minute on the documented cadence; it does **not** support a dependable final-5-second entry check. The dashboard does not fake a 5-second confirmation or claim tick-level precision. A true 5-second gate requires a separate authorized second-level market feed.
- Basic/Grow plans only permit trial WebSocket symbols; full symbol access requires Pro or higher. The live panel reports unavailable if EUR/USD is not included in the account's permitted trial symbols.
- This is a rule-based estimate, not a guarantee or a trained machine-learning model. Validate the next candle after close and measure accuracy before relying on it.
- Manual decision support only; no broker orders are placed.

## Runtime

- Node.js 18.x
- Express 4, node-fetch 2, ws 8
- `TWELVE_DATA_API_KEY` supplied privately through Render environment variables.

## Render

- Build: `npm install`
- Start: `npm start`
- Main service: https://ai-universal-signal-radar-main.onrender.com

## Endpoints

- `/health`: service status and live stream status
- `/api/signal`: closed-candle signal
- `/api/live`: separate live-price prediction
