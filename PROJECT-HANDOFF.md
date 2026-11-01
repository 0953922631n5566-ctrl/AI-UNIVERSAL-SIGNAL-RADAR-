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


## Mini App blank / Not Found investigation — 2026-11-01
- User opened the new Telegram Mini App and reported a dark screen with “Not Found” under bot title “Noghjklbot”.
- Render service details show active/not suspended, branch main-market, URL https://ai-signal-radar-main-market.onrender.com. Latest deployment before fix (commit 989ca34e515bcc514231b7f2de6a22cd7ad3a3d7) is status live; Render app logs show “MAIN MARKET Radar listening on 10000”.
- Inspected main-market/server.js and public/index.html: Express static serving was relative to process working directory. Although Render start command changes into main-market, harden path resolution to avoid working-directory-dependent 404s.
- Fix commit 8d2baf5878d66420b0e7bb66a8ffdef42434c087: resolve public directory relative to server.js via import.meta.url and explicitly serve index.html at GET /.
- Auto-deploy is enabled; verify new deploy reaches live and inspect request logs / user retest. Public HTTP endpoint remains inaccessible from assistant web runtime; do not claim the fix is confirmed on device until retested.
- Need distinguish whether the Telegram BotFather Menu Button currently points to this exact URL or an older bot URL. User screenshot/title alone does not prove which URL returned Not Found.


## API feed heartbeat and fail-closed lock — 2026-11-01
- User confirmed the Main Market Mini App opens and displays live EUR/USD Streaming + REST candle data. User requested a visible blinking green API indicator only while fresh API prices are actually arriving, and a red warning/locked STANDBY state on network/API/quota failure.
- Implemented on main-market branch:
  - 30eeb7ac3cb78ccb06aa2c9f35c4f6c96e43244d — server exposes API health state and fail-closed lock state.
  - 8f90eb88e5167384c21f3c41556a7690bb34a3e2 — frontend renders API LIVE / LOCKED / CONNECTING / OFFLINE and sends a Telegram alert (or browser alert) on lock transition.
  - df33a7b550e62948de7dbe14c5ce696aca513096 — blinking green live indicator and red locked/offline styling.
  - 2d3aa34d812f75c81d8fcdd9672c35519c165a86 — retain lock for quota/auth/rate-limit errors until API REST request succeeds again.
  - 0a5e2e76353da8fb2498697fcfb64ce8a5c7ecaf — block directional analysis while data is locked.
  - eec84305bcc6d8d308aab48e68d7380b009e8742 — display green API health after actual ticks even during 60-candle warmup.
  - 9b9c3008785102f925ff9d8b99253b94d6b39a50 — prevent repeated alerts during reconnect attempts.
- Semantics: ONLINE only becomes true after a valid EUR/USD live price tick; WebSocket open alone is CONNECTING. A 25-second live-tick timeout locks signal output to STANDBY. REST/API errors clear directional output and publish a lock reason. REST success can clear a quota/auth lock; a new live tick is still required for ONLINE status. STANDBY remains a market decision and is not itself an API error.
- User-visible API pill is independent of CALL/PUT signal: pulsing green API LIVE; red API LOCKED/OFFLINE; amber CONNECTING. Lock transition triggers Telegram WebApp showAlert when available, otherwise browser alert.
- Build/deploy for this feature batch must be rechecked after latest commit 9b9c3008785102f925ff9d8b99253b94d6b39a50. User device test is pending; do not claim the updated UI has been seen on device yet.

- Additional client-side outage protection: commit 2ec123f9d46c9063f7cea7a34d339df33cb38158. If the phone loses its WebSocket connection to Render, the Mini App immediately forces local STANDBY, paints the API pill red, clears the countdown, shows an outage alert, and attempts reconnection. This closes the separate case where the mobile internet drops while the server-side API connection has not yet reported its own failure.

- Build issue caught and corrected before considering the mobile-offline lock complete: commit 2ec123f9d46c9063f7cea7a34d339df33cb38158 initially failed Render's node --check because the reconnect handler contained a literal escaped newline. Corrected in f2c49d46b4c28dbec470026a478c3e7477a62150. Re-run Render build and verify latest deploy; do not use the failed deploy.

- Correction to the first syntax repair: the file contained a literal backslash followed by the letter n, not two backslashes. The initial replacement did not match; exact character-code inspection found and removed it. Final syntax repair commit: 67fd6c95ee11b3f9ee844f3bf09220deefeb679d. Verify Render node --check and latest deployment after this commit.


## 2026-11-01 — Fail-closed API outage handling fix

- User reaffirmed the MAIN MARKET Mini App scope and supplied the full product specification: Twelve Data EUR/USD Non-OTC 1M, adaptive situation-aware analysis, separate API health vs CALL/PUT/STANDBY, fail-closed behavior, manual trading only. The Android/OCR project on `main` remains out of scope and unchanged.
- Inspected `main-market/server.js`, `src/analyzer.js`, `src/twelve-data.js`, `public/index.html`, and `public/app.js` before editing.
- Found a runtime defect: WebSocket error/close paths called `lockData()`, but the function was not defined. REST sync failures only published a STANDBY message and did not set the API lock. The 25-second streaming watchdog also cleared signal output but did not consistently mark the API as LOCKED.
- Fixed in commit `efa61fdff0898221644e2119a864b62f0cf09537` (`fix: fail closed on Twelve Data API and stream outages`):
  - Added the missing `lockData()` handler, which clears held CALL/PUT state and publishes STANDBY with API LOCKED.
  - REST failures now enter the same lock path.
  - Authentication, authorization, quota and rate-limit errors are treated as fatal API locks; a later successful REST request clears the fatal latch, but API LIVE still requires a new actual streaming tick.
  - A missing streaming tick for more than 25 seconds now locks signal output and closes the stale stream for reconnect.
  - WebSocket error/rejection/close paths now share the safe lock behavior.
- Render service `srv-dbjls149v7es73ag0k4g`, branch `main-market`, automatically deployed commit `efa61fdff0898221644e2119a864b62f0cf09537`.
- Render deploy `dep-dbjmjf5g1s2s7384p9c0` reached status `live`. Build logs show `npm install` succeeded, 5 tests passed / 0 failed, and the server started with `MAIN MARKET Radar listening on 10000`.
- Local assistant network could not resolve the Render hostname, so an independent external HTTP GET of `/health` and browser rendering was not possible. Render itself reported the service live; user-side Mini App retest is still required.
- The existing analyzer still requires 60 candles and uses a transparent heuristic engine; it is not a trained AI model and has no validated predictive edge. Do not reduce warmup or alter strategy thresholds without a separate evidence-based task. Existing alerts, 40-second signal hold, and per-candle dedupe remain in place.
- Not yet verified: real Twelve Data WebSocket subscription with the user's account, live price arrival, mobile network loss behavior in Telegram, 10s/3s timing on device, and actual browser/Telegram rendering.
- Next: user opens the deployed Mini App, taps Start, and checks whether API becomes LIVE only after a real EUR/USD tick; if it remains CONNECTING/LOCKED, capture the visible message and matching Render logs. Then continue audit of alert timing and market-regime logic without weakening fail-closed behavior.


### Follow-up correction — HTTP status classification and latest redeploy

- Corrected a regex escaping issue in the new API error classifier so HTTP status codes 401, 403 and 429 are matched as numeric status codes, not as literal backslash text.
- Source commit: `c2e68b544b5c99ef186712a642633ef13f9c9e36`.
- Render deploy: `dep-dbjmk092tl4s73el5jj0`; build completed successfully. Render logs confirm the Node process started and printed `MAIN MARKET Radar listening on 10000`. At the latest poll the deploy API still reported `update_in_progress`, although the new instance had started and the service metadata reported not suspended. Recheck final deploy status.
- The handoff documentation update is recorded in this commit. It triggers an additional automatic deployment because auto-deploy is enabled; verify that final documentation-only deploy reaches live.
- External public HTTP checks remain unavailable from the assistant network due DNS resolution failure. Do not claim browser or end-user Telegram rendering has been verified.


## 2026-11-01 — Telegram Mini App Not Found: root index.html proposal checked

- Re-verified GitHub repository access: admin/maintain/push permissions are available. Active work remains isolated to branch `main-market`; do not change the Android/OCR project on `main`.
- Re-read this handoff and inspected the current branch tree, `main-market/server.js`, `main-market/package.json`, and `main-market/public/index.html`.
- Confirmed Render Web Service `srv-dbjls149v7es73ag0k4g` is connected to this repository, branch `main-market`, with rootDir empty, build command `cd main-market && npm install`, and start command `cd main-market && npm start`. Auto-deploy is enabled.
- The served page already exists at `main-market/public/index.html`. `main-market/server.js` resolves its public directory relative to `import.meta.url`, registers static serving from that directory, and explicitly handles `GET /` with `res.sendFile(path.join(APP_DIR,"public","index.html"))`. Therefore adding a duplicate `/index.html` beside the root README is not the correct fix for this service configuration and is intentionally not done; the Node service runs from `main-market` and explicitly serves its public index.
- Render deployment list confirms commit `937d25b8f1970ee7edf24bc44d122d5f7dd8204f` is the latest deployment and status `live` (deploy `dep-dbjmkhe417fc73b39e4g`). Render app logs confirm `cd main-market && npm start`, `MAIN MARKET Radar listening on 10000`, and Render's “Your service is live” message.
- Render request-log query returned no request entries in the queried window. Assistant web runtime could not access the public Render URL or `/health`, so HTTP response/body and browser rendering are not independently verified here. Telegram device rendering is also not verified.
- Most likely remaining diagnostic split: (1) BotFather Menu Button URL may point to a different/old URL or include a stale path, or (2) the correct URL may return an application/route issue not visible in the current empty request logs. Do not claim either cause as confirmed. Next step is verify the exact URL configured for the Mini App against `https://ai-signal-radar-main-market.onrender.com/` and inspect a fresh Render request log at the same time the user opens it.
- No source/runtime files changed in this investigation. Existing app behavior and Twelve Data secrets were left untouched. No new Render deploy was triggered by this diagnostic note.
- PM rule reaffirmed: treat the user's PM checklist as durable project handoff guidance; do not represent a chat message as an enforceable system prompt across all future sessions. Continue reading this file before each change and append verified results after each material implementation.


## 2026-11-02 — Main Market sound playback fix
- User reported that alert sound was not audible. Inspected the deployed branch source: the previous frontend created a brand-new Web Audio context only when a server event arrived, outside a user gesture, and never resumed a suspended context. Mobile Telegram WebViews can block/suspend that audio, so the sound code existed but playback was not reliably unlocked.
- Updated `main-market/public/app.js`: create and resume one persistent AudioContext from the Start button gesture (and when enabling sound); play audible two-note signal tones and distinct preparation tones through that context; keep sound toggle behavior; use Telegram HapticFeedback when available plus Android navigator.vibrate for vibration.
- No analyzer, market strategy, Twelve Data, alert timing, signal hold, or Android/OCR branch changes.
- Pending after commit: run JavaScript syntax check and project tests, verify Render auto-deploy reaches live, then user must tap Start in Telegram and confirm audible sound on the device. Actual device audio/vibration cannot be certified remotely.


## 2026-11-02 — Countdown alert timing correction
- User reported that the 10-second pre-close preparation sound was not audible. Re-inspection found the frontend called `clearInterval(timer)` and restarted the countdown on every WebSocket market-state update. Since updates arrive frequently, the countdown could repeatedly reset and skip the exact `left === 10` / `left === 3` checks.
- Fixed in source commit `12bb76dd01cc348b440aecfddf6c626e01e825b8`: keep one timer per candle-close timestamp, update the current signal without restarting the timer, poll at 100ms, and fire alerts when remaining time crosses 10s and 3s rather than requiring exact integer equality. Per-candle/per-signal threshold dedupe remains; STANDBY does not play entry warnings; 3s warning vibrates.
- Render deploy `dep-dbjnefnb9u1s73btrqbg` reached deployStatus=succeeded. Build completed successfully and Render logs show all 5 existing tests passed (0 failed). Existing test suite does not yet contain browser countdown/audio unit tests.
- Previous audio-context unlock fix remains in place. User-side Telegram/Xiaomi audio and vibration confirmation is still pending; do not claim device playback is verified until user tests it.
- No market analysis rules, 60-candle warmup, Twelve Data settings, signal hold, Android/OCR branch, or manual-only trading policy changed.


## 2026-11-02 — Fix missed 10s / 3s preparation sounds

- User reported that the final 10-second pre-close monitoring sound was not playing.
- Re-read this handoff and inspected the active main-market/public/app.js, main-market/public/index.html, and main-market/server.js before changing code.
- Root cause confirmed in the frontend countdown logic: when the same candle countdown was already running, every incoming market-state update returned early. If the signal changed from STANDBY to CALL/PUT after the 10-second or 3-second boundary had passed, the alert was never replayed. The old code only checked threshold crossings on timer ticks, and the signal gate suppressed the warning while STANDBY.
- Fixed in commit 478d2bb992451067d7decf60531ada0df27d62fe (fix: catch up missed pre-close sound alerts):
  - Detect transition from STANDBY/non-directional to CALL/PUT while the same candle countdown is active.
  - If the remaining time is already within 10 seconds, play the preparation sound immediately.
  - If the remaining time is already within 3 seconds, play both the preparation and entry-preparation sounds, plus vibration, subject to per-candle/per-signal deduplication.
  - STANDBY remains silent; existing countdown, candle timing, signal sound, vibration controls and server-side strategy are otherwise unchanged.
  - Recreate AudioContext if the browser/Telegram WebView has closed it.
- GitHub update completed on branch main-market. Render auto-deploy is enabled; wait for the deploy triggered by this source commit and verify build/test/deploy status before reporting completion.
- Still required: verify audible playback on the user's physical Android/Telegram device. Render/build success cannot prove the phone's speaker, Telegram WebView audio policy, media volume or DND behavior.


## 2026-11-02 — Add immediate sound and vibration test controls
- User provided the current Mini App screen; it showed only notification enable/disable checkboxes, not dedicated test buttons. Confirmed the checkboxes do not produce a test sound or vibration when tapped: they only enable/disable future alerts.
- Added separate **ทดสอบเสียง** and **ทดสอบสั่น** buttons below the notification toggles. Each invokes its test immediately from the user's tap; test actions deliberately bypass the notification toggle so the user can test the phone independently. Normal market alerts still respect their respective toggles.
- No change to analyzer, market strategy, API, countdown timing, signal hold, candle warmup, or Android/OCR branch.
- Validation/deployment pending: run syntax checks and project tests, then verify Render auto-deploy. Physical speaker/vibration still requires the user to tap the buttons on the Xiaomi/Telegram device.
