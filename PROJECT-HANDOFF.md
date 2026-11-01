# PROJECT HANDOFF — AI UNIVERSAL SIGNAL RADAR

## Project separation
- Existing Android/OCR system remains unchanged on main.
- New MAIN MARKET Telegram Mini App is isolated on branch main-market.
- Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-.

## PM operating standard
Inspect GitHub permissions and read this file before each task. Implement directly where possible, adapt when blocked, preserve existing functionality, run tests/build/deploy checks, update this handoff and commit every material change. Report implemented/tested/built/deployed/live-verified/device-tested/production-validated separately. Never claim 100% reliability or Production-Ready without evidence. This is durable project guidance, not a system prompt that can force unrelated sessions.

## Requirements
- Twelve Data only; EUR/USD only; Non-OTC; 1-minute.
- Situation-aware market perception and regime selection: TRENDING, RANGING, HIGH_VOLATILITY, REVERSAL, UNCLEAR.
- Adaptive evidence includes EMA, RSI, MACD, price action, support/resistance, volatility and momentum.
- Outputs CALL / PUT / STANDBY with auditable reasons. No fake confidence scores.
- Stale, missing, conflicting or unconfirmed data => STANDBY.
- Mini App displays results directly; never send signal messages to Telegram chat.
- Pre-close alerts at 10s and 3s; 3-second entry preparation; CALL/PUT sound and vibration; signal hold 40s; per-candle dedupe; no STANDBY alert.
- Start/STOP monitoring in Mini App. Manual trading only; never place broker orders.
- No OCR, OTC or Android screen capture in this branch.
- Secrets must stay server-side and never enter GitHub or client bundles.

## Implemented in initial main-market branch commit
- Node 20 / Express / WebSocket app under main-market/.
- Twelve Data REST time-series client plus Twelve Data live-price WebSocket attempt.
- Tick-based 1-minute OHLC aggregation and REST resync.
- Transparent adaptive heuristic engine: EMA 9/21/50, RSI14, MACD, ATR ratio, range and support/resistance.
- Market regime classification and conservative STANDBY-first decisions.
- 40-second signal hold, direction flip guard and per-candle dedupe.
- Mini App UI with start/stop, state, evidence, countdown, sound and vibration toggles.
- Unit tests and Node test script.
- REST resync defaults to 120s (about 720 requests/day while active), staying below the published Basic 800/day quota with limited headroom.

## Known limitations / external checks
- Twelve Data WebSocket access depends on plan/account entitlement; verify actual subscribe response. If unavailable, REST fallback operates at 120s and cannot provide reliable 10s/3s live timing. UI should remain STANDBY when the tick feed is stale.
- Twelve Data Basic currently lists 8 API credits/minute and 800/day; the time-series endpoint costs 1 credit per symbol. Confirm the user's account's actual limits.
- The rule engine is not a trained ML model and has no demonstrated predictive edge.
- No historical backtest, paper-trading, latency, false-positive, or out-of-sample validation yet.
- No Telegram bot token supplied. BotFather can set Menu Button URL manually; server-side initData validation remains a security enhancement to add once a bot token is provided.
- No live Render deployment, public endpoint check, or Telegram device test is confirmed until verified after deployment.
- Do not call this Production-Ready before security, operational, end-to-end, and market-validation gates pass.

## Deployment plan
Render Free Web Service, Singapore, branch main-market; build: cd main-market && npm install; start: cd main-market && npm start. Configure TWELVE_DATA_API_KEY only as a Render environment secret. Never commit it.

## Latest task status
- GitHub repo and admin/push permissions verified.
- Read current main-branch handoff before editing.
- Created isolated branch main-market; main and its existing Render Static Site were not modified.
- Initial app source and tests committed to branch; see latest commit link in task report.
- Next: create Render Free web service for branch, set API key as server-side secret, deploy, test /health, Twelve Data REST and WebSocket, then verify Mini App.

## 2026-11-01 — Implementation and deployment checkpoint

- Initial branch source commit: 4e03c0bafc683e824cf9544e1e5cc3a3a4a01da8.
- Freshness guard commit: 40e71d4647c9e3ce4ca1c6f285f46bab63f6f095; directional output now requires a live streaming tick no older than 25 seconds.
- Signal invalidation commit: c7846b018790336d891dc34c174d6462a3f958b7; missing metrics/freshness clears any held signal rather than retaining CALL/PUT.
- Render Free Web Service created: service ID srv-dbjls149v7es73ag0k4g, Singapore, branch main-market, URL https://ai-signal-radar-main-market.onrender.com.
- TWELVE_DATA_API_KEY was provisioned as a Render environment secret only. It is not in the repository, frontend, or APK. The user should rotate the key because it was pasted into a chat message; update the Render secret after rotation.
- First deploy of initial source commit reached Render status live. Deploys for the two subsequent safety fixes were queued/in progress at this checkpoint. Health endpoint and actual market data not yet verified.
- Build log for first deploy: Node 20.20.2 installed; npm install completed; 70 packages added; 0 vulnerabilities reported; Render reported Build successful. This is dependency installation, not proof of runtime correctness.
- GitHub commit status endpoint returned no checks at this checkpoint; CI test result is not yet verified.
- No Telegram bot token is configured. BotFather can point the Menu Button at the deployed URL, but server-side initData verification and hardened per-user controls remain pending.
- Not Production-Ready: live WebSocket entitlement, REST auth, 10s/3s alert timing, Telegram Android behavior, and chronological market validation remain to be tested.
