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

## Final implementation checkpoint — 2026-11-01

### Latest source commits
- 40e71d4647c9e3ce4ca1c6f285f46bab63f6f095 — require fresh streaming ticks for directional analysis.
- c7846b018790336d891dc34c174d6462a3f958b7 — clear held signals when freshness/evidence is missing.
- ff2d3263eac8a8f7780359f6284b9e64b0c436e5 — run unit tests during install.
- 08079e4bad3e0aa30daf76ea2b9118c25a562bf7 — reset candle context across missing minute gaps.
- 27a20e05cc73925ecbff590d4c92076abc917bc9 and 37d2c2afebcaa504e935aae53d22b620ef41d329 — reset alert deduplication and suppress STANDBY sounds.
- 95b47aa74c4351298ff38bd8ff1e27fa71c3bf4a — add JS syntax checks to install/build.
- 3a20e24224fb162f37e60c4a831776b3b8c7ed10 — add price-action body and 5-bar momentum evidence.
- 354791c7a8a6687e30c39677d4377a435b7359ef — report actual WebSocket readiness and detect stale ticks.
- 18307988a8b2726f76dc97cc59f8cd34b221b162 — reconnect on absent usable stream ticks.
- acee90d32c7c2394c9c278a8d3daf2e41ff1b851 — prevent stop/reconnect socket races.

### Verified deployment evidence
- Render service: srv-dbjls149v7es73ag0k4g; Free plan; Singapore; branch main-market.
- Public URL: https://ai-signal-radar-main-market.onrender.com
- Latest source deployment: dep-dbjltg2qphnc73e4ohdg, commit acee90d32c7c2394c9c278a8d3daf2e41ff1b851.
- Render build log confirms Node 20.20.2, npm install, test command, 5 tests passed / 0 failed, JavaScript node --check chain completed without syntax errors, Build successful, and app process started with “MAIN MARKET Radar listening on 10000”.
- Render deployment API still reported update_in_progress at the last poll despite successful build and application startup logs; re-check deploy status and service events.
- External HTTP health/UI check could not be performed from this assistant environment (web/container network could not resolve/access the Render URL). Do not claim /health or browser UI independently verified.
- The service was created with TWELVE_DATA_API_KEY as a Render environment secret. The secret value is not recorded here or in GitHub. Since the user pasted the key into chat, advise rotating it and updating the Render secret directly in Dashboard after rotation.
- The Mini App does not send Telegram chat messages. BotFather can set the menu URL, but BOT_TOKEN/initData verification has not been configured.
- The Twelve Data live WebSocket subscription has not yet been exercised by a real Mini App client. User must open the URL and press Start; then inspect Render logs and state for a successful EUR/USD price stream. If account plan denies WebSocket, app deliberately remains STANDBY; 120-second REST sync is not fast enough to promise 10s/3s live alerts.
- Not Production-Ready: no end-to-end Telegram Android test, no confirmed WebSocket subscription, no external health/UI check, no security initData validation, no paper-trading/backtest/out-of-sample market validation.

### Deployment status correction — 2026-11-01
- Rechecked Render service events after the prior checkpoint.
- Latest handoff commit 801e05fef89076dc2f3724cfac49dac93b9b45cd completed successfully: build succeeded, deploy ended with deployStatus=succeeded.
- Application process startup was observed in Render logs: “MAIN MARKET Radar listening on 10000”.
- Render reports the service is not suspended and uses the Free plan in Singapore.
- Public HTTP health response and real browser rendering remain unverified from this assistant environment; the URL is ready for the user to open.
