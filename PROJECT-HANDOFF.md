# PROJECT HANDOFF — AI UNIVERSAL SIGNAL RADAR

Updated: 2026-11-02

## Full replacement completed
- Repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`
- Branch: `main`
- Scope: MAIN MARKET / NON-OTC only, EUR/USD, M1, manual signal review only. No Android/OCR, Telegram authentication, OTC or broker order execution.
- Replaced repository tree with: `package.json`, `server.js`, `public/index.html`, `README.md`, `PROJECT-HANDOFF.md`.
- Removed legacy paths: `.github/`, `android/`, `backend/`, and old root `index.html`.
- Implementation commit: `71c3b370e53f5c92cc7a54b2caa2bcd2ba92df36` — Full replacement: EUR/USD M1 AI Signal Radar Node service.

## Architecture
1. Market Perception: validated closed Twelve Data candles; EMA5/20/50, RSI14, MACD, ATR and ADX.
2. Market Regime: Trending, Ranging, High Volatility, Reversal, or UNCLEAR.
3. Adaptive Analysis: evaluates EMA alignment, momentum, RSI and MACD evidence.
4. Decision Engine: CALL / PUT / STANDBY with score and evidence; stale/insufficient/unsafe conditions fail to STANDBY.
5. Continuous Monitoring: scheduled provider refresh, data-age checks, one signal per closed candle, 40-second signal hold and expiry.

## Runtime and endpoints
- Node.js >=20; `npm start`; no third-party npm dependencies.
- Required Render environment variable: `TWELVE_DATA_API_KEY` (server-side only; do not commit the key).
- Optional: `DATA_REFRESH_MS=125000`, `MAX_CANDLE_AGE_MS=180000`, `MIN_SIGNAL_SCORE=68`.
- REST polling default is about 691 calls/day if continuously running. It cannot guarantee tick-level 10s/3s alerts or minute-by-minute signal evaluation. Browser countdown and local 10s/3s sound/vibration alerts are based on the device clock.
- Five candles are the minimum intake threshold; directional signals wait for adequate history for EMA50/RSI/MACD/ADX (at least 51 candles).
- Endpoints: `GET /api/health`, `GET /api/state`, `GET /api/candles`, `POST /api/start`, `POST /api/stop`.

## Render deployment
- New Node Web Service: `ai-universal-signal-radar-main`
- Service ID: `srv-dbkaoo0473hc7384tmog`
- URL: https://ai-universal-signal-radar-main.onrender.com
- Region: Singapore; plan: Free; branch: `main`; build: `npm install`; start: `npm start`; auto deploy: enabled.
- Deploy ID: `dep-dbkaoog473hc7384tp4g`; status: `live` (2026-11-02 15:30 UTC).
- Render build event: succeeded. Logs confirm `npm install` succeeded, `npm start` ran, and server printed `AI UNIVERSAL SIGNAL RADAR listening on 10000`.
- IMPORTANT: `TWELVE_DATA_API_KEY` has not been configured on this newly created service. Until the key is added in Render Environment, the app will serve its UI and health endpoint but market scanning will fail safe to STANDBY with a missing-key error. Do not mistake LIVE deployment for verified live market data.
- Existing static-site service and older backend service have not been deleted from Render; only GitHub branch `main` was replaced. The static site cannot run Node.js and is no longer the target service. The new Node Web Service above is the target URL.

## Verification boundaries
- Verified: GitHub main tree contains only the five replacement files; Render build succeeded; Node process started; Render reports deployment LIVE.
- Not yet verified: Twelve Data live data until the API key is configured; actual signal session; device-specific browser audio/vibration. No automatic broker orders are sent.
