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
- Backend marks a pair REST_ONLY if Streaming is unavailable. Its current analyzer explicitly requires a fresh Streaming tick for CALL/PUT; REST history can populate context/indicators but the safe output remains STANDBY without a live tick.
- Therefore the new UI labels REST_ONLY as REST FALLBACK but does not claim REST-only directional signals are enabled. To enable directional decisions from REST alone, backend analyzer, polling cadence, signal freshness/expiry rules, and tests must be changed and deployed as a separate backend task. Do not bypass this safety gate in the browser or expose API keys.

## Render configuration
- Frontend service: srv-dbk35e8ae00c73fmpi30, workspace tea-db8qa8nf3r2c73f1htk0, auto deploy on main commits.
- Backend service: srv-dbjls149v7es73ag0k4g, branch main-market, rootDir blank, build: cd main-market && npm install, start: cd main-market && npm start.
- Secrets remain in Render environment variables; never commit tokens or API keys.

## Verification required
- GitHub Actions should parse inline JavaScript and verify the six pairs, API origin/routes, and controls.
- Check Render deployment status after commit.
- Source publication does not prove Telegram authentication, Twelve Data access for each pair, Streaming entitlements, live ticks, Android audio/vibration, or end-to-end signals. These remain unverified until tested in the user's Telegram session.
- Preserve STANDBY for stale, unsupported, invalid, or insufficient data. Keep OCR/OTC separate from MAIN MARKET.
