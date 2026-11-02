# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-02

## Scope
MAIN MARKET only: EUR/USD, 1-minute timeframe. Legacy Android, OCR, OTC, and Telegram code is not part of this repository's active project.

## Files in main
- `package.json`: Express 4, node-fetch 2, Node 18.x, npm start.
- `server.js`: Twelve Data EUR/USD 1-minute feed, EMA 5/20, RSI 14, regime classification, stale-data safety, CALL/PUT/STANDBY, one-new-candle cooldown. Also exposes `apiStatus` and `apiMessage` so the UI can distinguish connected, quota exhausted, and other API errors. Signal calculations and cooldown rules are unchanged.
- `public/index.html`: redesigned compact mobile dashboard with CALL/PUT/STANDBY signal panel, circular M1 countdown/progress ring, EUR/USD price, blinking connected API indicator, explicit quota/error text, and icon-only power toggle. Audio/vibration alerts remain: signal-change alert plus 10-second and final-3-second countdown alerts. Audio starts after the user's first power-button interaction because browsers require a user gesture.
- `README.md`: runtime and operational notes.

## API status behavior
- `connected`: API request returned market candles; UI shows a blinking green API indicator.
- `quota_exhausted`: Twelve Data response indicates quota/credits/rate limit exhaustion (including HTTP/API code 429); UI shows “โควต้าหมด”.
- `error`: other API/server errors; UI shows API error status.
- The quota classifier depends on Twelve Data's error message/code. If the provider changes its wording, verify classification against the actual response.

## Alternating candle rule
When an evaluation emits CALL or PUT, `cooldownActive` is set. On the next newly observed candle timestamp, evaluation returns STANDBY and clears cooldown. A subsequent candle may qualify again. This is signal candle -> skip one candle -> eligible to evaluate again, not guaranteed alternating CALL/PUT directions.

## Deployment
Render service intended for this repository: `ai-universal-signal-radar-main`
Service ID: `srv-dbkaoo0473hc7384tmog`
URL: https://ai-universal-signal-radar-main.onrender.com
Branch: main
Build: `npm install`
Start: `npm start`
Runtime: Node 18.x

## Required secret
Set `TWELVE_DATA_API_KEY` privately in Render Environment. Never place the key in GitHub, source code, screenshots, or chat. Without the key, live market requests cannot succeed.

## Verification checklist
- [ ] Render deploy for latest UI/API-status commit reaches Live.
- [ ] Render environment contains TWELVE_DATA_API_KEY.
- [ ] `/api/signal` returns fresh EUR/USD values and `apiStatus: connected`.
- [ ] Test quota response and confirm `apiStatus: quota_exhausted` and Thai quota label.
- [ ] Confirm API error status separately from quota exhaustion.
- [ ] Confirm candle timestamps and cooldown behavior over at least three new M1 timestamps.
- [ ] Test signal/countdown audio and vibration on target Android browser after tapping the power icon once.

## Known technical limitations
- The API's last returned candle may still be forming; code does not filter to confirmed closed candles.
- RSI is a simple 14-period calculation over the first 15 closes of the returned 30-candle array, not Wilder-smoothed RSI.
- The regime logic is a compact rule-based filter, not a trained AI/ML model.
- Audio/vibration and countdown are client-side and depend on browser permissions and a user gesture.
- Manual signal support only; no automatic broker execution.
- API status blinking confirms successful API responses, not that a trading signal is present or that an order should be placed.
