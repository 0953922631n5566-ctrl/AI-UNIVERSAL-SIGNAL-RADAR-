# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-02

## Scope
MAIN MARKET only: EUR/USD, 1-minute timeframe. Legacy Android, OCR, OTC, and Telegram code is not part of this repository's active project.

## Files in main
- `package.json`: Express 4, node-fetch 2, Node 18.x, npm start.
- `server.js`: Twelve Data EUR/USD 1-minute feed, EMA 5/20, RSI 14, regime classification, stale-data safety, CALL/PUT/STANDBY, one-new-candle cooldown. Exposes `apiStatus` and `apiMessage` for connected, quota exhausted, and other API errors.
- `public/index.html`: uses the user's supplied circular signal-screen design: EUR/USD price badge at top, central CALL/PUT/STANDBY light, Candle Close (1M) and Signal Expiry timers, and icon-only power button. No random/simulated price or signal generation; reads only `/api/signal`. API connected state blinks green; quota exhaustion displays “โควต้าหมด”; other errors display “API ขัดข้อง”. Signal expiry is a client-side 40-second hold from first detection of a new CALL/PUT signal for that candle; after expiry the UI holds STANDBY until the next candle timestamp. Countdown alerts remain at 10 seconds and final 3 seconds; signal transition plays sound/vibration after browser audio has been enabled by a user gesture.
- `README.md`: runtime and operational notes.

## API status behavior
- `connected`: successful Twelve Data response; UI shows a blinking green API indicator.
- `quota_exhausted`: provider message/code indicates quota, credits, rate limit, or HTTP/API 429; UI displays “โควต้าหมด”.
- `error`: other API/server errors; UI displays “API ขัดข้อง”.
- Quota classification depends on provider error text/code and should be checked against the actual Twelve Data response.

## Signal and cooldown
When an evaluation emits CALL or PUT, `cooldownActive` is set. On the next newly observed candle timestamp, evaluation returns STANDBY and clears cooldown. A subsequent candle may qualify again. This is signal candle -> skip one candle -> eligible to evaluate again, not guaranteed alternating CALL/PUT directions.
The UI's 40-second expiry timer is client-side display/hold behavior. The backend signal engine remains unchanged by the UI redesign.

## Deployment
Render service: `ai-universal-signal-radar-main`
Service ID: `srv-dbkaoo0473hc7384tmog`
URL: https://ai-universal-signal-radar-main.onrender.com
Branch: main
Build: `npm install`
Start: `npm start`
Runtime: Node 18.x
Auto deploy: enabled

## Required secret
Set `TWELVE_DATA_API_KEY` privately in Render Environment. Never place the key in GitHub, source code, screenshots, or chat. Without the key, live market requests cannot succeed.

## Verification checklist
- [ ] Render deploy for latest commit reaches Live.
- [ ] Render environment contains TWELVE_DATA_API_KEY.
- [ ] `/api/signal` returns fresh EUR/USD values and `apiStatus: connected`.
- [ ] Test quota response and verify `apiStatus: quota_exhausted` and Thai quota label.
- [ ] Verify API errors remain distinct from quota exhaustion.
- [ ] Confirm candle timestamps and backend cooldown over at least three new M1 timestamps.
- [ ] Verify 40-second UI signal expiry and that it remains STANDBY until next candle.
- [ ] Test audio/vibration on Android after a user gesture.

## Known technical limitations
- The API's last returned candle may still be forming; backend does not filter to confirmed closed candles.
- RSI is a simple 14-period calculation over the first 15 closes of the returned 30-candle array, not Wilder-smoothed RSI.
- The regime logic is a compact rule-based filter, not a trained AI/ML model.
- Audio/vibration depend on browser permissions and user gesture.
- Manual signal support only; no automatic broker execution.
- API blinking confirms successful API responses, not that a trade signal is present or an order should be placed.


## Experimental Fast Signal A (2026-11-03)
- Work is isolated on branch `experiment/fast-signal-a`; draft PR #10: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/pull/10
- Added `experimental/fast-signal.js`: directional score from EMA3/EMA8, RSI5, 3-candle momentum normalized by ATR14, MACD(5,13,4), latest candle body, and close-to-close direction. CALL/PUT threshold 55 with 15-point directional edge; otherwise STANDBY. Score is not a probability.
- Added `experimental/fast-signal.test.js` and GitHub Actions workflow. CI run #1 completed successfully: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/41583524759
- Added `FAST-SIGNAL-PLAN.md` describing the rules, test assumptions, and limitations.
- This experiment is not integrated into `server.js`, not merged to `main`, and not deployed to Render. Production remains on `main`.
- Unit tests use synthetic rising/falling fixtures only. No real-market historical backtest or profitability claim has been established yet.
- The backtest helper signals on candle i close, enters at candle i+1 open, and evaluates candle i+1 close. It does not model spread, slippage, payout, or execution latency.
- Production feed currently refreshes Twelve Data REST M1 candles every 120 seconds; this cannot deliver a fresh signal each minute or tick-level signals. Investigate eligible real-time WebSocket entitlement before increasing cadence.
