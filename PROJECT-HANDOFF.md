# PROJECT HANDOFF — AI UNIVERSAL SIGNAL RADAR

Updated: 2026-11-02

## Full replacement
- Repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`
- Branch: `main`
- Scope: MAIN MARKET / NON-OTC only, EUR/USD, M1, manual signal review only. No Android/OCR, Telegram authentication, OTC or broker order execution.
- Files: `package.json`, `server.js`, `public/index.html`, `README.md`, `PROJECT-HANDOFF.md`.
- Removed legacy paths: `.github/`, `android/`, `backend/`, old root `index.html`, and old README content.

## Architecture
1. Market Perception: validated closed Twelve Data candles; EMA5/20/50, RSI14, MACD, ATR and ADX.
2. Market Regime: Trending, Ranging, High Volatility, Reversal, or UNCLEAR.
3. Adaptive Analysis: evaluates EMA alignment, momentum, RSI and MACD evidence.
4. Decision Engine: CALL / PUT / STANDBY with score and evidence; stale/insufficient/unsafe conditions fail to STANDBY.
5. Continuous Monitoring: scheduled provider refresh, data-age checks, one signal per closed candle, 40-second signal hold and expiry.

## Runtime
- Node.js >=20; `npm start`; no third-party npm dependencies.
- Required Render environment variable: `TWELVE_DATA_API_KEY` (never commit the key).
- Optional: `DATA_REFRESH_MS=125000`, `MAX_CANDLE_AGE_MS=180000`, `MIN_SIGNAL_SCORE=68`.
- REST polling default is about 691 calls/day if continuously running. It cannot guarantee tick-level 10s/3s alerts or minute-by-minute signal evaluation. Browser alerts are based on the local minute clock.
- Minimum candle intake is 5; directional signals wait until sufficient indicator history exists (at least 51 candles for EMA50/ADX).
- Endpoints: `GET /api/health`, `GET /api/state`, `GET /api/candles`, `POST /api/start`, `POST /api/stop`.

## Commit / Build / Deploy status
- Commit: pending at time of this handoff update.
- GitHub Actions: no workflow retained in the replacement tree; local syntax check is `npm run check`.
- Render: source replacement will trigger the existing static-site service on branch main, but that service type cannot run Node.js. A separate Node Web Service must be created with build command `npm install` and start command `npm start`.
- Deploy is not confirmed until the new Render Web Service reports LIVE and `/api/health` returns `ok: true`.
- Live Twelve Data access and device audio/vibration must be tested with the user's API key and browser/device.
