# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-02

## Scope
Full replacement for MAIN MARKET only: EUR/USD, 1-minute timeframe. Legacy Android, OCR, OTC, and Telegram code is not part of this repository's active project.

## Files in main
- `package.json`: Express 4, node-fetch 2, Node 18.x, npm start.
- `server.js`: Twelve Data EUR/USD 1-minute feed, EMA 5/20, RSI 14, regime classification, stale-data safety, CALL/PUT/STANDBY, one-new-candle cooldown.
- `public/index.html`: compact Thai-language dashboard, price/regime/reason/timer, audio and vibration controls.
- `README.md`: runtime and operational notes.

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
- [ ] Render deploy for this commit reaches Live.
- [ ] Render environment contains TWELVE_DATA_API_KEY.
- [ ] `/api/signal` returns fresh EUR/USD values (not stale/error).
- [ ] Confirm actual candle timestamps and cooldown behavior over at least three new M1 timestamps.
- [ ] Test audio/vibration on the target Android browser after pressing ENABLE AUDIO / VIBRATION.

## Known technical limitations in the requested code
- The API's last returned candle may still be forming; code does not filter to confirmed closed candles.
- RSI is a simple 14-period calculation over the first 15 closes of the returned 30-candle array, not Wilder-smoothed RSI.
- The regime logic is a compact rule-based filter, not a trained AI/ML model.
- Audio/vibration and countdown are client-side and depend on browser permissions/user gesture.
- Manual signal support only; no automatic broker execution.
