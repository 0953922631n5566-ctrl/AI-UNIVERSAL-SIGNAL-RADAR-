# PROJECT HANDOFF — AI UNIVERSAL SIGNAL RADAR
Updated: 2026-11-02

## Architecture
- Frontend: root index.html, a single-file HTML/CSS/JavaScript Mini App. No root app.js or styles.css dependency.
- Render frontend: my-ai-signal-bot-v2, service srv-dbk35e8ae00c73fmpi30, https://my-ai-signal-bot-v2.onrender.com, branch main, publish path .
- Backend: separate Node service ai-signal-radar-main-market, service srv-dbjls149v7es73ag0k4g, https://ai-signal-radar-main-market.onrender.com, branch main-market, source main-market/.
- API contract: POST /api/auth with Telegram initData; GET /api/state; POST /api/control actions start, select, heartbeat, stop.

## Scope
- MAIN MARKET / NON-OTC only, M1, manual signal review only, no automatic broker orders.
- Six pairs: EUR/USD, AUD/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- UI: CALL / PUT / STANDBY, regime, reason/evidence, EMA, RSI, MACD, price, age, countdown, scan controls, sound and vibration.
- No simulated data, random signals, demo API key, or browser-exposed Twelve Data secret.

## Clean-sheet root replacement
- Previous root index.html was replaced with newly authored single-file source. Root README.md and PROJECT-HANDOFF.md were also recreated.
- Loose root files are index.html, README.md, PROJECT-HANDOFF.md. The .github, android, and backend directories are preserved: they are directories containing CI, Android build sources, and service code, not loose root files.
- Existing backend API contract and Telegram authentication are retained so the new frontend can connect to the separately deployed service.

## REST / Streaming limitation — important
- Backend currently fetches historical M1 candles through Twelve Data REST and separately attempts price Streaming.
- Backend marks a pair REST_ONLY if Streaming is unavailable. In this mode it analyzes only closed M1 candles fetched through Twelve Data REST, provided the latest candle is no older than 180 seconds.
- REST fallback refresh cadence is 180 seconds (maximum 480 REST refreshes/day for one continuously monitored selected pair). A fresh REST fallback may produce CALL/PUT using the same evidence engine; stale/invalid/insufficient REST data remains STANDBY. The UI identifies this as REST FALLBACK.
- Streaming remains preferred when a fresh tick is available. No API key is exposed in the browser. REST-only signal behavior is covered by a new analyzer test and must be confirmed by CI and Render deployment.

## Render configuration
- Frontend service: srv-dbk35e8ae00c73fmpi30, workspace tea-db8qa8nf3r2c73f1htk0, auto deploy on main commits.
- Backend service: srv-dbjls149v7es73ag0k4g, branch main-market, rootDir blank, build: cd main-market && npm install, start: cd main-market && npm start.
- Secrets remain in Render environment variables; never commit tokens or API keys.

## Verification required
- GitHub Actions should parse inline JavaScript and verify the six pairs, API origin/routes, and controls.
- Check Render deployment status after commit.
- Source publication does not prove Telegram authentication, Twelve Data access for each pair, Streaming entitlements, live ticks, Android audio/vibration, or end-to-end signals. These remain unverified until tested in the user's Telegram session.
- Preserve STANDBY for stale, unsupported, invalid, or insufficient data. Keep OCR/OTC separate from MAIN MARKET.
