# PROJECT HANDOFF — AI UNIVERSAL SIGNAL RADAR

## Project separation
- Existing Android/OCR system remains unchanged on main.
- New MAIN MARKET Telegram Mini App is isolated on branch main-market.
- Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-.

## PM operating standard
Inspect GitHub permissions and read this file before each task. Implement directly where possible, adapt when blocked, preserve existing functionality, run tests/build/deploy checks, update this handoff and commit every material change. Report implemented/tested/built/deployed/live-verified/device-tested/production-validated separately. Never claim 100% reliability or Production-Ready without evidence. This is durable project guidance, not a system prompt that can force unrelated sessions.

## Requirements
- Twelve Data only; six selectable Non-OTC pairs: AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- Scan exactly one selected pair at a time; EUR/USD is the default. Switching pairs clears the prior pair's active signal context and loads/reuses the newly selected pair's history.
- 1-minute candles (1M); never scan all six concurrently.
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

## 2026-11-02 — Monitoring Start appears frozen: feed diagnostics and fail-visible correction

- User confirmed the sound and vibration test buttons work, but reported that pressing Start monitoring leaves the Mini App apparently frozen.
- Re-verified repository access, main-market branch head d074ba2965faadf4fa3f247ec09d92d38912e9c4, read this handoff, and inspected the live source files main-market/server.js, main-market/public/app.js, main-market/public/index.html, and main-market/src/twelve-data.js.
- Confirmed the latest deployed UI source contains a Start handler that opens/reuses /live and sends {action:start} once the socket is open. The server then starts a Twelve Data REST history sync and a Twelve Data WebSocket subscription. Existing UI has no backend runtime diagnostics, so a failed/missing API key or streaming failure was difficult to distinguish from a frozen screen.
- Implemented a targeted backend observability/fail-visible correction in source commit b521a215b5797e5d34559817eb44564430ab3ebf (fix: surface monitoring feed connection failures):
  - Missing TWELVE_DATA_API_KEY now enters the explicit fail-closed LOCKED state instead of remaining indefinitely in CONNECTING.
  - Log monitoring start, WebSocket open/subscription, first received price, subscription errors, WebSocket errors/close, REST sync failures, and every lock reason in Render app logs.
  - Catch synchronous WebSocket-constructor errors and schedule the existing reconnect path rather than leaving monitoring in an unhandled exception.
  - Existing STANDBY/fail-closed rules remain; no fabricated price, no automatic trading, no change to the analyzer, 60-candle warmup, alert timing, signal hold, or Android/OCR branch.
- Render source deploy dep-dbjsfu2vcj2c73fcj3sg for commit b521a215b5797e5d34559817eb44564430ab3ebf reached status LIVE. Build logs show npm install/postinstall succeeded, all 5 existing tests passed (0 failed), Node syntax checks passed for server.js, public/app.js, src/twelve-data.js, and src/analyzer.js, and the new instance started with MAIN MARKET Radar listening on port 10000. Render logged Your service is live.
- Runtime feed behavior after the user presses Start has not yet been captured on this deployment; the app runtime logs queried immediately after deploy contained only process startup and no fresh user session. The public Render URL and /health endpoint remain inaccessible from the assistant web runtime, so no independent HTTP/browser response claim is made.
- Documentation commit for this update is being recorded separately; because Render auto-deploy is enabled, its documentation-only deployment must also be checked to reach LIVE.
- Root cause is not yet proven: the currently available Render logs predate this report and contain no recent user request/stream activity, and the assistant environment cannot independently fetch the Render public URL. The new diagnostics are intended to reveal whether the key is missing, REST history fetch fails, WebSocket subscription is rejected, or no price events arrive.
- Next actions: verify source deployment reaches LIVE; inspect fresh app logs after the user taps Start; if a specific Twelve Data/API failure appears, fix that cause. Do not ask the user to change API settings unless logs prove an external credential/plan issue. User-side Mini App retest is required only after the deployment is live.


## 2026-11-02 — REST history completion / analysis refresh fix

- User's Mini App screen showed API LIVE and a valid EUR/USD live price, but analysis remained at STANDBY with only 1/60 candles.
- Render app logs for the user's exact Start event confirm:
  - `23:17:28.536Z` — `[market-feed] START requested` for EUR/USD 1min.
  - `23:17:29.287Z` — Twelve Data WebSocket OPEN and subscription sent.
  - `23:17:32.040Z` — first live price received.
  - No REST history completion/failure log existed, so the number of historical candles returned could not be verified from that session.
- Inspected `main-market/server.js`, `main-market/src/twelve-data.js`, and this handoff on branch `main-market`.
- Confirmed a race in `sync()`: after REST history merged into the live candle buffer, it called `analyze()` only when no WebSocket tick had arrived yet. If the first live tick arrived before REST completed, the 60-candle history could be loaded without immediately refreshing the UI/analysis.
- Fixed in source commit `6dd794f43fceae3f6cd9bad566b41eda51f11bca` (`fix: reanalyze after REST candle history loads`):
  - Always re-run analysis after a successful REST history merge, whether or not a live tick has already arrived.
  - Add a structured `[market-feed] REST history loaded` log with the REST candle count, merged buffer count, and whether a live tick exists.
  - Keep the 60-candle warmup, Twelve Data EUR/USD 1min settings, stale-data guard, alert timing, 40-second signal hold, and manual-only/no-auto-orders policy unchanged.
- Source commit pushed to `main-market`. Render auto-deploy is enabled; build/test/deploy status must be checked after this commit.
- Existing Render logs prove WebSocket open and first live price, but do not yet prove how many REST candles were returned. The new log will distinguish REST history success from an API/response error on the next start or refresh.
- Device retest is pending after the updated deployment reaches LIVE. Do not claim the 60 candles were successfully loaded or that the on-device screen is fixed until the next Render log and Mini App state confirm it.
- Android/OCR branch `main` was not modified.


## 2026-11-02 — Main Market pre-close alert and shorter warmup correction

- User reported that the 10-second pre-close sound remained silent after repeated earlier fixes, and that a 60-candle warmup was too long.
- Inspected the current main-market branch, this handoff, frontend countdown/audio code, analyzer, Twelve Data REST parser, server warmup branch, and Render service/deploy/log state before editing. The Android/OCR branch main was not changed.
- Render logs from the prior live session show Twelve Data REST successfully returned 120 historical candles (received: 120, available: 120/121) shortly after Start. Therefore, 60 candles did not require waiting 60 minutes when REST history is available; the visible 1/60 state was the live tick arriving before the REST request completed. Historical data is fetched in one REST request.
- Confirmed frontend alert logic was explicitly gated on CALL/PUT, so the 10-second attention warning did not play while the signal was STANDBY. Also, the server's warmup response omitted nextCandleAt, so the client had no countdown to drive an alert while warming up.
- Implemented on main-market:
  - 557750a46e9994039842ea5bc88c3751d4979b4f — 10-second watch chime is now separate from trade-direction alerts; it plays once per candle when monitoring is active and API is ONLINE, including during STANDBY. The 3-second entry-preparation sound/vibration remains restricted to confirmed CALL/PUT. Immediate CALL/PUT sound is only emitted during active monitoring with API ONLINE.
  - f58827a5b6ce98f63ab70780b2176a33da4d2c90 — analyzer now uses the 30-bar warmup-compatible indicator set: EMA 9/21/26, RSI 14, MACD 12/26 with 5-period signal, ATR 14/20, 20-bar support/resistance and 5-bar momentum.
  - 4b0409e60822b4126704cf80f85f448866865314 — server uses the shared 30-candle threshold and publishes the candle-close timestamp even during warmup so the pre-close timer can run.
  - 6ecbca0b7428e5b214dfc3c8fe27939cfc00cc51 — Twelve Data history validation aligned to 30 minimum candles; still requests up to 120 historical candles for context.
  - 31a7af47a36ae8515bf3677d919b5e19edce8331 — analyzer tests updated for 29-bar standby and successful 30-bar calculation.
  - 6a95c108172714efd53138aa51c491888e1c5a54 — shared MIN_CANDLES=30 configuration.
- Strategy tradeoff: warmup is reduced from 60 to 30 minutes of 1-minute bars. The shorter indicator set is more responsive and may be noisier than EMA50/MACD9/ATR50. It remains an analysis aid, not a proven predictive model; manual-only/no-auto-orders and fail-closed freshness checks remain.
- Validation status at time of handoff update: GitHub source commits succeeded. Render auto-deploy build, automated test result, final LIVE deployment, and real Telegram/Xiaomi audio timing still require verification. The assistant cannot certify physical-device speaker output remotely.
- Next: verify the latest source deploy includes all six source commits, check Render build logs for 5 passing tests and syntax checks, verify final deploy status LIVE, then ask user to close/reopen the Mini App and test one real 10-second candle boundary while API LIVE. Confirm the 10-second watch chime in STANDBY and the 3-second entry alert only when CALL/PUT is present.


### Validation update — 2026-11-02

- Render build for branch main-market at commit 2247e8cf469005c5c4626f6a964a198e0bbe0603 completed successfully.
- Render build logs confirm the updated 30-candle boundary test passed (29 candles => STANDBY; 30 candles => metrics available), all 5 tests passed / 0 failed, and the postinstall Node syntax-check chain completed successfully.
- Render deploy dep-dbjsoe3il8vc73amjn70 reached status LIVE; Render deploy event records deployStatus=succeeded. The new app process started and logged MAIN MARKET Radar listening on port 10000.
- This verifies build, automated tests, and Render deployment only. It does not prove audible output on the user's Xiaomi/Telegram WebView. The user must reopen the Mini App and confirm the next 10-second boundary sound while API LIVE; this is the remaining acceptance test.


## 2026-11-02 — Historical preload increased to 200 closed candles

- User explicitly authorized implementation of historical preload so Main Market does not wait for new candles to accumulate after opening.
- Scope remains isolated to branch `main-market`; Android/OCR branch `main` is untouched.
- Implemented source changes:
  - `80e91f078f7c80d1029a49ca86a1824e5c6f8037` — shared settings: minimum 200 closed 1-minute candles, request 220 historical bars, retain up to 260 bars, REST refresh default 300 seconds.
  - `5eb4bf8ff04067485209fefc576a95bce0556a7f` — Twelve Data REST parser requests 220 bars, removes the still-forming current minute candle, and refuses to return history unless at least 200 fully closed bars are present.
  - `e8d0312db67891c3f38720fd1361b8af15eca1ba` — analyzer warmup counts only fully closed candles; a current live candle cannot be counted as one of the 200 historical bars.
  - `a02e56d4ca73263f8b429449758ca312d7a6cc43` — server loads 220 historical bars on Start and on 5-minute resync, merges only a fresh current-minute live candle, reports loaded/required counts, and retains historical context.
  - `df326f101f78dff0c904c10c0add0d37d9533485` — marks a live candle closed when the next minute begins and avoids merging a stale live candle over newer REST history.
  - `e1a287c41d9effc8bae33ea032dff515d0a8527a` — adds tests for 199 closed + 1 live = not ready, and 200 closed + live = metrics ready.
  - `67258dace60bdad14f854a0373d2aa01b81036f1` — updates stale-data test to use a full 200-candle history.
- API quota optimization: EUR/USD remains one symbol; one REST time-series request retrieves the 220 bars. Periodic REST refresh is now every 300 seconds by default (about 288 scheduled refreshes per 24 hours while monitoring continuously, plus the initial fetch), instead of every 120 seconds. WebSocket remains the live-price channel. This reduces REST request frequency; it does not change the user's Twelve Data plan or guarantee their actual quota allowance.
- Important runtime behavior: a successful 220-bar response should yield at least 200 fully closed bars immediately, so the user does not wait 200 minutes. Directional analysis still requires a fresh live WebSocket tick; if REST returns fewer than 200 closed bars or the live feed is unavailable/stale, the system deliberately remains STANDBY.
- Render validation:
  - First intermediate deployment for config-only commit `80e91f...` failed because the existing test still expected 30; this was a temporary out-of-sync commit during sequential file updates, not a runtime failure. The test was then updated for 200.
  - Build for commit `e1a287c41d9effc8bae33ea032dff515d0a8527a` completed successfully and logs showed 5 tests passed / 0 failed. At the last check its deploy was still `update_in_progress`; latest commit `67258dace60bdad14f854a0373d2aa01b81036f1` was queued. Recheck the latest queued deploy and require status LIVE before calling this change deployed.
- Not yet verified: actual Twelve Data response returns 200+ fully closed EUR/USD bars after the change; the runtime log `REST history loaded` must confirm `receivedClosed >= 200`. Also not yet verified: real Telegram/Xiaomi session reaches metrics immediately after the first live tick. No prediction accuracy or trading performance is claimed.
- User-facing target: opening Mini App and tapping Start should fetch history immediately, calculate with 200 completed candles as soon as the first fresh WebSocket price arrives, then continue live updates. No automated broker orders; manual-only policy and existing alerts/signal hold remain unchanged.


- Quota-safety follow-up commit `453768ca3598a0fe8fc361b6e17ff2d199db3d04`: REST sync is now shared/in-flight guarded and rate-limited to one request per configured 300-second interval across WebSocket reconnects. Reconnect loops cannot cause a fresh REST credit every few seconds. Stop clears the interval and permits a fresh history request on the next user Start.
- The complete final code state now includes the stale-live-candle merge fix (`df326f101f78dff0c904c10c0add0d37d9533485`), revised full-length stale-data test (`67258dace60bdad14f854a0373d2aa01b81036f1`), and REST reconnect quota throttle (`453768ca3598a0fe8fc361b6e17ff2d199db3d04`). Their final Render deployment and build checks remain pending at this handoff revision.


### Final validation update — 2026-11-02

- Final branch head deployed: `9636afbe434eef0fae8fab323719223e7505d30e`.
- Render deploy `dep-dbjsuk3il8vc73amn9t0` reached status `live`; Render event records `deployStatus=succeeded`.
- Render build log for the final commit shows the 200-candle warmup boundary test passed, stale 200-candle test passed, all 5 tests passed / 0 failed, npm audit reported 0 vulnerabilities, and Build successful. The configured postinstall command includes Node syntax checks for server.js, public/app.js, src/twelve-data.js and src/analyzer.js; the build completed successfully.
- Render runtime logs confirm the final instance started with `MAIN MARKET Radar listening on 10000` and Render reported `Your service is live`.
- The prior source deploy `dep-dbjsuc12tl4s73eq4840` also reached LIVE before the final quota-throttle/handoff revision. Final deploy supersedes it.
- Still pending real data acceptance: user must press Start in the Mini App; inspect Render log `[market-feed] REST history loaded` and confirm `receivedClosed >= 200`, then confirm a fresh WebSocket tick enables metrics without a 30/60/200-minute accumulation wait. This has not been observed in a post-deploy user session yet.
- External HTTP GET /health and Telegram/Xiaomi device display/audio were not independently verified in this run. Do not claim these checks passed.
- Handoff-only update; use `[skip render]` so documentation does not trigger a redundant service deployment.


## 2026-11-02 — Increase Main Market notification volume

- User confirmed the 10-second pre-close watch sound is now audible and working normally. Directional CALL/PUT entry alert has not yet been heard in a real signal event, so that acceptance test remains pending.
- User reported that the alert sound level was too quiet and asked to increase it.
- Inspected the current `main-market/public/app.js` on branch `main-market`. The Web Audio oscillator gain envelope peaked at `0.18` for all generated tones.
- Updated the peak gain from `0.18` to `0.32` (approximately 5 dB higher amplitude, subject to device/browser output behavior). This increases the 10-second watch, 3-second entry-preparation, and CALL/PUT tones consistently.
- Source commit: `43790b6d06c745ffb9cf171ccc91c283417fe589`.
- Preserved tone frequencies, duration, alert timing, per-candle deduplication, sound toggle, vibration behavior, signal logic, 200-closed-candle preload, and manual-only/no-auto-orders policy. No Android/OCR branch changes.
- Render auto-deploy is expected from the source commit; build/test/deploy status must be checked before asking the user to reload. Physical loudness and CALL/PUT playback must still be verified on the user's Xiaomi 11T / Telegram WebView. The user may also need to raise Android media volume; app gain cannot override the phone's system volume or silent/DND settings.


## 2026-11-02 — Main Market six-pair selection and per-pair support reporting

- User explicitly authorized adding all six pairs and requested a visible/alerted warning for any pair the Twelve Data account does not support:
  - AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- Work is isolated on branch `feature/multi-pair-monitor`, based on the deployed `main-market` branch. Android/OCR branch `main` remains untouched.
- Implemented in the feature branch:
  - Six-pair configuration; all six are selected by default, with multi-select checkboxes and browser-local selection persistence.
  - Independent candle history, tick freshness, analysis, signal hold, per-candle deduplication and status for each selected pair.
  - One shared Twelve Data price WebSocket subscription for selected symbols, with per-symbol subscribe result handling.
  - Individual REST history checks; pairs rejected for invalid symbol, permission, plan or subscription reasons are marked UNSUPPORTED and excluded from directional signals.
  - Per-pair cards display CALL / PUT / STANDBY, last price, RSI, data age, reason and support/connection state.
  - Unsupported pairs trigger a Telegram WebApp alert (browser alert fallback) and remain visibly marked on the dashboard.
  - Sound/vibration signal alert and the existing 10-second / 3-second candle alerts are deduplicated independently per pair.
  - REST refresh interval changed to 900 seconds. At six symbols and one REST credit per symbol per refresh, the planned cadence is approximately 576 REST credits/day (96 refreshes × 6 symbols), below the published Basic 800/day quota, assuming all six are selected continuously and no additional retries/restarts.
  - Repeated Stop/Start within the 15-minute cache window reuses successful history instead of spending another six REST credits immediately.
- Preserved: 200 fully closed historical candles, request of 220 bars, existing EMA/RSI/MACD/ATR and situation-aware heuristic, fail-closed STANDBY behavior, 40-second signal hold, sound gain 0.32, manual-only trading and no broker order placement.
- Provider entitlement caveat: Twelve Data documentation says Basic/Grow WebSocket access is trial-limited to eligible symbols; full WebSocket access depends on plan. A successful REST history response does not prove a pair is eligible for live Streaming. The app must verify actual subscribe results and fresh price ticks per pair. A pair without fresh streaming remains non-directional / STANDBY.
- Validation at this handoff point: source edits and a six-pair/quota configuration test have been committed to the feature branch. Automated tests, Node syntax checks, Render build/deploy, actual account symbol eligibility and Telegram/Xiaomi device behavior are NOT YET VERIFIED. Do not describe the feature as deployed or live until the PR is merged and Render reports the final deployment LIVE.
- Next steps: inspect the complete diff, merge the feature branch into `main-market`, verify Render build runs all tests and syntax checks, confirm the deploy reaches LIVE, then have the user press Start and inspect per-symbol REST/subscribe/tick logs. Confirm unsupported pairs explicitly and ensure supported pairs independently receive fresh ticks before allowing CALL/PUT.


### Final validation — six-pair Main Market deployment (2026-11-02)

- PR #1 merged into `main-market`; merge commit / deployed source: `da6be43cc5a80ecd538fd9d5793c4291bcdfc80b`.
- Render deploy: `dep-dbjtgbbncjis73e0p5bg`; deploy-ended event reports `deployStatus=succeeded`. Render log at 2026-11-02T00:24:50Z says `Your service is live`, and the new process logged `MAIN MARKET multi-pair Radar listening on 10000`.
- Render build completed successfully. Postinstall output confirms 7 tests passed / 0 failed, including the new exact-six-symbol and 900-second REST cadence test. The postinstall command also chains `node --check` for server.js, public/app.js, src/twelve-data.js and src/analyzer.js; the build completed successfully after the test command.
- Render URL remains https://ai-signal-radar-main-market.onrender.com. Service branch remains `main-market`; the Android/OCR `main` branch and its service were not changed.
- Code/build/deploy verified. NOT YET VERIFIED: actual live REST history and WebSocket subscription acceptance for each of the six symbols under the user's Twelve Data account, visible UI on Telegram/Xiaomi, per-pair unsupported alerts, and physical CALL/PUT/10s/3s audio/vibration.
- User acceptance test: open/reopen the Main Market Mini App, select the pairs to scan (all six are checked by default), tap Start, and observe each card. Any rejected symbol/plan/stream is shown as `ไม่รองรับ` with an alert; only a pair with at least 200 closed history candles and a fresh Streaming tick may produce CALL/PUT. If any pair remains CHECKING/WAITING/ERROR, inspect fresh Render logs before altering credentials or plan.
- Do not describe the six symbols as all supported until runtime logs show successful REST history and fresh Streaming ticks for each. The app intentionally keeps unsupported/stale pairs out of directional signal output.


### Streaming support timeout clarification and final redeploy — 2026-11-02

- Added a per-pair timeout when a WebSocket subscription is acknowledged but no first price arrives within 25 seconds.
- Distinguish explicit provider rejection (`UNSUPPORTED`) from no first tick (`STREAM_TIMEOUT` / “ยังยืนยันไม่ได้ว่าคู่นี้รองรับหรือไม่”). This avoids falsely claiming a pair is unsupported merely because the market is closed, the provider is delayed, or no tick has arrived yet. Both states remain non-directional / STANDBY and trigger a visible user alert.
- Final source commits for this clarification:
  - `e7993430e5b164d1f97a75d21b13239586993947` — server reports missing first Streaming ticks separately from unsupported pairs.
  - `1aab251c816741850612739a82d698e2830056d6` — timeout applies even after a successful subscribe acknowledgement.
  - `37a29d00dc39c4458c816e143c36511040286dce` and `3c46a1ea8f37f5bf9fdb6c1e6cd3d266691b5c22` — client warning/label and readable alert formatting.
- Latest Render deploy: `dep-dbjtgu0gbm7c7383a8ug`, source commit `3c46a1ea8f37f5bf9fdb6c1e6cd3d266691b5c22`, status `live`, finished 2026-11-02T00:26:37Z. Build log confirms 7 tests passed / 0 failed, the configured Node syntax-check chain passed, and the process started with `MAIN MARKET multi-pair Radar listening on 10000`.
- Still pending: user-side Mini App refresh and real Twelve Data account acceptance per pair; no claim that all six currently have Streaming permission until fresh logs show it. The app is deployed, but runtime support and audible/haptic acceptance must be checked after the user taps Start.


## 2026-11-02 — Restore original single-pair Main Market scanner with pair selector

- User chose to return to the original single-market scanning model rather than scan all six pairs concurrently.
- UI now uses mutually exclusive radio-style pair choices for AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY and GBP/USD. EUR/USD is the default selection.
- When monitoring is running and the user selects a different pair, the client sends a `select` action; the server closes the previous WebSocket, clears signal state/timers for the old pair, changes the selected symbol, loads/reuses that pair's 220-bar REST history, and subscribes to Streaming for that one pair only.
- Start action is server-enforced to accept exactly one symbol even if a stale client sends multiple symbols.
- Restored REST resync cadence from 15 minutes to 5 minutes (300 seconds), appropriate for a single selected pair. Render env var `REST_SYNC_SECONDS` was explicitly set to `300` so an older 900-second environment override cannot defeat the restored cadence.
- Preserved original analysis behavior: 200 closed-candle warmup, 220 history request, EMA/RSI/MACD/ATR/Price Action, STANDBY on stale/missing data, 40-second signal hold, 10s/3s alerts, CALL/PUT sound and vibration, manual-only/no auto-orders.
- Files changed: `src/config.js`, `server.js`, `public/app.js`, `public/index.html`, `test/analyzer.test.js`.
- Test now asserts six selectable symbols, only EUR/USD as the default, and 300-second REST refresh.
- Pending validation: Render build/test/deploy and actual user-device switching between symbols. Do not call this change live until Render reports the latest deploy LIVE. Check that the selected pair alone is shown and receives fresh ticks after changing radio selection.


### Deployment verification — single-pair scanner (2026-11-02)

- Final server refinement commit: `3d7a2283075b39e17cea29c553c597dc364970e7`.
- Render deployment `dep-dbjtnhdg1s2s738d4glg` finished `live` at 2026-11-02T00:40:06Z; deploy-ended event reports `succeeded`.
- Build logs: 7 tests passed / 0 failed; configured `node --check` chain completed and build reported successful. New process log confirms `MAIN MARKET single-pair Radar listening on 10000`.
- Runtime config: `REST_SYNC_SECONDS=300` on Render; one REST history refresh per selected pair every five minutes.
- Verified by source/build/deploy only. Not yet device-verified: user must close/reopen Telegram Mini App, select another pair while running, confirm only one pair card appears and fresh live price is received. Do not claim all six pairs are provider-supported; only the currently selected pair is checked, and unsupported selection must remain STANDBY with a clear warning.


## 2026-11-02 — Restore compact dropdown pair selector and address frozen/overloaded Mini App layout

- User reported the deployed Main Market Mini App appeared stuck and asked to restore the prior compact screen with one pair-selection button that opens an in-page dropdown menu, rather than showing six pair choices permanently on the screen.
- Confirmed Render service `ai-signal-radar-main-market` uses repository `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`, branch `main-market`, URL `https://ai-signal-radar-main-market.onrender.com`. Android/OCR on `main` remains out of scope and untouched.
- Inspected current `main-market/public/index.html`, `public/app.js`, `public/styles.css`, `server.js`, configuration and tests. The latest deployed source used six always-visible radio rows/grid in the selector area. This is the concrete UI mismatch with the requested compact dropdown. The current deployment was LIVE; Render logs show process startup and successful deploy, but they do not establish the user's exact on-device freeze cause.
- Work is isolated to branch `fix/main-market-dropdown-selector` based on the deployed single-pair source commit `3d7a2283075b39e17cea29c553c597dc364970e7`.
- Planned UI fix: replace the always-visible six-pair grid with one selected-pair summary button; tapping opens an overlay dropdown menu containing the same six radio options. Selecting an option closes the menu, updates the selected-pair label and local preference, and preserves the existing live single-pair switch action.
- Preserve server-side single-pair enforcement, EUR/USD default, 200 closed-candle warmup, 220-bar REST preload, 300-second REST refresh, existing analysis/alerts and fail-closed STANDBY rules. No strategy or provider logic is intentionally changed.
- Add an automated markup regression test to ensure the compact dropdown exists and six options remain available without the old always-visible selector grid.
- Validation/build/deploy and merge status are pending; do not ask the user to reload until the updated branch is merged, Render reports a successful LIVE deployment, and service logs confirm startup.
- Device-specific Telegram WebView behavior and whether this resolves the reported freeze still require the user's Xiaomi/Telegram acceptance test. If the UI still freezes, obtain a screenshot and inspect fresh request/app logs before changing market logic.


### Dropdown restoration — build and deployment verification (2026-11-02)

- PR #2 merged into `main-market`; merge/squash commit: `f73ed6f2838979e9316f836f85ea5ce4d0cc1068`.
- Render deployment: `dep-dbjtrne417fc73bbtng0`, source commit `f73ed6f2838979e9316f836f85ea5ce4d0cc1068`, status `live`; finished 2026-11-02T00:49:05.938Z.
- Render build completed successfully. Build logs confirm the new dropdown regression test passed, all 8 tests passed / 0 failed, npm audit reported 0 vulnerabilities, and the configured Node syntax-check chain ran as part of postinstall without a build failure.
- Render runtime logs confirm the new process started successfully: `MAIN MARKET single-pair Radar listening on 10000` at 2026-11-02T00:48:58Z.
- Service remains on Free / Singapore / branch `main-market`, URL `https://ai-signal-radar-main-market.onrender.com`. No paid resource or market strategy change.
- The six always-visible pair choices were replaced with a single selected-pair dropdown trigger and an overlay menu. Selection closes the menu and updates the selected pair display. Existing live pair-switch action, EUR/USD default, 200-candle preload, 300-second REST refresh, analysis and alert behavior are preserved.
- Not yet verified: public HTTP response body from this assistant environment, actual rendering/interaction inside Telegram WebView on Xiaomi 11T, whether this resolves the user's reported freeze, and real Twelve Data streaming acceptance for each chosen pair. The user must close the old Mini App and reopen the deployed URL to receive the new HTML/CSS/JS. Do not claim device acceptance or market feed correctness until observed.
- Next acceptance test: reopen the Mini App, confirm the screen shows one compact pair button, tap it to see the six options, select AUD/USD, then select EUR/USD while monitoring. Confirm the menu closes after selection, the selected label changes, and the status accurately reports LIVE/unsupported/waiting without fabricating a signal.


## 2026-11-02 — Large manual entry signal display redesign

- User requested a larger, clearer signal light to help decide when to manually enter an order.
- Work isolated on branch `feature/large-entry-signal-display`, based on latest `main-market`. Android/OCR `main` branch untouched.
- UI change: replace the small CALL/PUT/STANDBY text with a prominent signal panel, large circular lamp, large directional label, and explicit Thai action guidance: CALL = พิจารณาเข้า CALL; PUT = พิจารณาเข้า PUT; STANDBY = ยังไม่เข้าออเดอร์. Green for CALL, red for PUT, neutral grey for STANDBY.
- Make the selected single-pair card full-width on mobile, enlarge pair name/status, price/RSI/data-age metrics and candle countdown. Preserve the compact pair dropdown and existing sound/vibration controls.
- No changes to EMA/RSI/MACD/ATR/Price Action calculations, signal thresholds/hold, data freshness requirements, alert timing, Twelve Data integration, single-pair selection, or server-side no-auto-orders behavior.
- Add regression coverage that the client renders all three large signal states and the CSS defines distinct CALL/PUT/STANDBY lamp styling.
- Validation/build/deploy and actual Telegram/Xiaomi display remain pending. Do not ask user to refresh until the PR is merged and Render deployment is confirmed LIVE.


### Large entry signal redesign — deployment verification (2026-11-02)

- PR #3 merged into `main-market`; squash commit: `a3874e37ea6639b783d45217f2ea7f8b6d832a35`.
- Render deployment `dep-dbjttgqvcj2c73fe1e50` reached `live`; deploy-ended event reports `succeeded` at 2026-11-02T00:52:46Z.
- Build log confirms 9 tests passed / 0 failed, including the new large CALL/PUT/STANDBY display regression test. npm audit reported 0 vulnerabilities. Configured Node syntax-check chain ran as part of successful postinstall/build.
- Runtime log confirms `MAIN MARKET single-pair Radar listening on 10000`; Render reported `Your service is live`. Primary URL remains `https://ai-signal-radar-main-market.onrender.com`.
- New interface replaces small signal text with a large circular lamp and large CALL/PUT/STANDBY label. Green CALL, red PUT, neutral grey STANDBY. Thai action guidance differentiates “พิจารณาเข้า CALL/PUT” from “ยังไม่เข้าออเดอร์”. Pair card is full-width and price/RSI/data-age/countdown are enlarged for mobile.
- Preserved: compact pair dropdown, six selectable pairs but one active pair, EUR/USD default, existing analysis and data-quality gates, 200 closed-candle warmup, alert timing/sound/vibration, and manual-only/no-auto-orders behavior. No Android/OCR changes.
- Not yet verified: visual rendering on user's Telegram WebView/Xiaomi 11T and physical CALL/PUT sound/vibration; no live signal event was fabricated for UI testing. User should close/reopen Mini App to load the new assets. If display still appears cached, fully close Telegram Mini App and reopen the link.


## 2026-11-02 — Neon regime / AI reasoning UI enhancement (implementation branch)

- User supplied a neon-style HTML prototype and asked to use its additional presentation ideas while retaining the previously approved Main Market screen/layout.
- Reviewed current handoff, live branch source, analyzer output contract and UI. The existing UI already had the large CALL/PUT/STANDBY lamp, single-pair dropdown and manual-only behavior.
- Added a compact MARKET REGIME badge mapped from the analyzer's actual regime field (TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY, REVERSAL, UNCLEAR/UNKNOWN) and an explicitly labeled AI REASONING panel using the analyzer's actual reason string.
- Added subtle neon pulse animation to directional CALL/PUT lamps with reduced-motion support. STANDBY remains visually neutral grey as in the approved Main Market design.
- Deliberately excluded prototype simulation/autocycling, fabricated sample regimes, manual test CALL/PUT controls, OTC default, unsupported BTC/ETH choices, and broker-order buttons/sendData order payloads. These would misrepresent the real Twelve Data feed or conflict with manual-only/no-auto-order requirements.
- No analyzer rules, candle warmup, market-data source, pair list, alert timing, signal hold, or server order behavior changed.
- Added regression test for actual regime/reason rendering and absence of simulation/order UI.
- Implementation branch: feature/neon-regime-reasoning-ui. Tests/build/PR/deployment/device validation pending.


### Neon regime / reasoning UI — deployment verification (2026-11-02)

- PR #4 merged into `main-market`; squash commit: `5cc7a7a83198fe552ae9277a9f04c5e3da355e12`.
- Render deployment: `dep-dbju142vcj2c73fe4bc0`, status `live`; deploy-ended event reports `succeeded` at 2026-11-02T01:00:41Z.
- Build logs confirm 10 tests passed / 0 failed, including the new live regime/reasoning UI regression test. npm audit reported 0 vulnerabilities; Node syntax checks completed as part of postinstall.
- Runtime logs confirm the new process started: `MAIN MARKET single-pair Radar listening on 10000`. Render reports the deployment live.
- Public URL remains https://ai-signal-radar-main-market.onrender.com. User should fully close and reopen the Telegram Mini App to refresh the new assets.
- Implemented: actual analyzer regime badge, AI REASONING panel using the live reason string, subtle animated CALL/PUT lamps with reduced-motion support. STANDBY remains neutral grey.
- Preserved: prior approved mobile layout, compact single-pair selector, EUR/USD default, market calculations, 200 closed-candle warmup, freshness/API locks, signal hold, alert timing/sound/vibration, and manual-only/no-auto-orders behavior.
- Excluded prototype-only simulation/autocycling, fake CALL/PUT test states, OTC default, unsupported crypto options, and broker order buttons.
- Not yet verified: actual Telegram WebView rendering on Xiaomi 11T, device sound/vibration, and live market feed behavior after refresh. Render LIVE/build success does not establish those device checks.


## 2026-11-02 — Full Kawasaki neon Main Market layout (user-approved visual reference)

- User clarified that the supplied HTML is the exact visual direction desired for the Telegram Mini App, not merely a request to add a reasoning box. Rebuilt the Main Market UI shell to match the reference: near-black/green Kawasaki neon palette, Universal Radar header and connection pill, selected-pair + M1 bar, large pulsing CALL/PUT/neutral STANDBY lamp, Market Regime badge, AI REASONING panel, neon pair-selection modal, start/stop controls, sound/vibration preferences and compact footer.
- Pair selector is now a modal rather than the previous inline details dropdown. It retains only the six existing Main Market supported NON-OTC pairs (AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD), defaults to EUR/USD, and continues scanning one selected pair at a time.
- Live data and analyzer outputs remain authoritative: signal, regime, reason, price, RSI, feed status and candle countdown are populated from the existing Twelve Data/Main Market WebSocket state. No demo cycling or fabricated scenarios.
- Deliberately excluded from the supplied prototype: OTC default, BTC/USD and ETH/USD (not configured in this Main Market service), CALL/PUT manual broker-order buttons, Telegram sendData order payloads, force-standby order button and fake test-signal controls. The app remains manual-only and does not place broker orders.
- Preserved analyzer formulas, 200 closed-candle warmup, feed freshness locks, 40-second signal hold, 10-second pre-alert, 3-second entry alert, sound/vibration behavior, Twelve Data API handling and backend pair switching.
- PR #5 merged into `main-market`; squash commit: `1b71d38920fc58994ca5fe2d31f585035d5f701f`.
- GitHub Actions Main Market Checks run #70 succeeded. Render build succeeded; Render deployment `dep-dbk0i8h5efls73eh559g` reached `live` and deploy-ended event reported `succeeded` at 2026-11-02T03:53:43Z. Runtime logs confirm `MAIN MARKET single-pair Radar listening on 10000` and `Your service is live`.
- Primary URL: https://ai-signal-radar-main-market.onrender.com. Ask the user to fully close/reopen Telegram Mini App to refresh. Visual layout and pair-modal interaction on the user's Xiaomi 11T Telegram WebView, plus actual sound/vibration, still require device acceptance testing; do not claim those are verified.


## 2026-11-02 — Audio/haptics reliability and simplified Mini App UI (in progress)

- User reported the Telegram Mini App appeared frozen and neither the alert sound test nor vibration test produced a physical response. Render being LIVE is not proof of browser/device media behavior.
- Root cause found in deployed client code: the sound-test button reported "sent" without awaiting/checking playback; when the sound toggle was off, the test path could create an AudioContext and then skip the actual tone because the tone function used the non-forced unlock path. The vibration test also always reported success while silently swallowing unsupported/failed API calls.
- Work isolated on `fix/main-market-audio-haptics-simple-ui`: create/resume Web Audio directly from the test button's user gesture, await playback setup, report Web Audio unsupported/blocked errors, use Telegram HapticFeedback first and browser vibration as fallback, and report unsupported/rejected vibration instead of false success.
- Simplified Main Market presentation to a compact dark-green layout with clear pair selection, one prominent live signal, compact regime/reason, start/stop, and separate sound/vibration tests. No demo signal or auto-order functionality.
- Preserve server/analyzer logic, Twelve Data, six supported NON-OTC pairs, one-pair-at-a-time behavior, 200 closed-candle warmup, data freshness locks, signal hold, and 10s/3s alert policy.
- Automated regression tests added for device-test handling and simplified UI. GitHub Actions Main Market Checks run #76 succeeded: 13 tests passed / 0 failed, including the new sound/haptics and simplified-layout regressions. npm install succeeded. PR #6 is open for merge; Render deployment and on-device acceptance are pending. Alert playback failures are surfaced in the on-screen test-status line rather than becoming unhandled promise rejections. The former neon-animation CSS assertions were updated to match the simplified static lamp style.
- Device limitation: a web app can confirm Web Audio API readiness and whether the browser accepted a vibration command, but cannot prove that the phone physically emitted sound/vibration. Telegram WebView/Android media volume, DND, system vibration settings and app permissions still need physical acceptance.


### Audio/haptics simplified UI — merge and deployment verification (2026-11-02)

- PR #6 merged into `main-market`; squash commit: `e56bc461ba826f276e65cdec0a82b5998d979a11`.
- Source branch: `fix/main-market-audio-haptics-simple-ui`.
- GitHub Actions Main Market Checks run #76 passed: npm install succeeded; 13 tests passed / 0 failed, including audio/haptics diagnostics and simplified-layout regressions.
- Render deployment `dep-dbk0m5bm8hqs738a7m1g` reached `live`; deploy-ended event reports `succeeded` at 2026-11-02T04:02:03Z.
- Render runtime logs confirm process startup: `MAIN MARKET single-pair Radar listening on 10000`; Render reports `Your service is live`.
- Updated client now initializes/resumes Web Audio from the direct user tap, awaits test-tone setup and displays an error when Web Audio is unavailable or blocked. This fixes the previous test-path bug where a disabled sound toggle could prevent the forced test tone.
- Vibration test now calls Telegram HapticFeedback when available, falls back to browser vibration otherwise, and displays unsupported/rejected results rather than always claiming success. The UI explicitly distinguishes a sent haptic command from confirmed physical vibration.
- Replaced the visually dense Kawasaki neon shell with a simpler compact dark-green screen. Retained actual live CALL/PUT/STANDBY, regime/reason, price/RSI/data age/countdown, single-pair selector, start/stop and sound/vibration controls.
- No changes to server, market calculations, Twelve Data, 200 closed-candle warmup, 40-second signal hold, 10s/3s alert timing, freshness locks, six NON-OTC pairs or manual-only behavior. Android/OCR branch remains untouched.
- Post-deploy error-log query after 04:02:03Z returned no error entries at the time checked.
- Public endpoint/browser UI could not be fetched from this assistant network environment (DNS resolution failure / web fetch inaccessible). Render's successful deploy event and runtime startup logs are verified, but external HTTP response and user's Telegram/Xiaomi rendering remain unverified.
- Physical speaker/vibrator behavior cannot be tested remotely. User acceptance remains required: fully close/reopen Telegram Mini App, tap each test button, and verify actual phone output. If test status says unsupported/blocked, use that exact message to diagnose the device/browser setting. Do not report device acceptance until confirmed.


## 2026-11-02 — Telegram Mini App connectivity fallback and cache hardening (in progress)

- User reported that the Main Market Telegram Mini App is entirely unusable after the prior sound/UI release.
- Rechecked the latest `main-market` source, deployment events, service config and runtime logs. Render service `srv-dbjls149v7es73ag0k4g` is configured for repository branch `main-market`, root directory empty, build `cd main-market && npm install`, start `cd main-market && npm start`. Deployment `dep-dbk0m5bm8hqs738a7m1g` for `e56bc461ba826f276e65cdec0a82b5998d979a11` reached LIVE and logs show app listening on port 10000. The preceding build ran 13 tests with 13 passed / 0 failed.
- Render request-log query returned no HTTP request records in the inspected window; this does not prove the Mini App URL is wrong, but means no user page request could be matched to the service. Assistant network could not resolve the public Render hostname, so independent HTTP GETs for `/`, `/health`, `/api/state`, `/app.js` and `/styles.css` are not possible from this environment.
- Implementing HTTP control/polling fallback so the UI can still start/select/stop and receive state if Telegram WebView cannot establish or retain WebSockets; a 12-second client heartbeat lease preserves scan-only-while-open behavior and stops scanning after the fallback client disappears.
- Add no-cache headers for HTML/JS/CSS and explicit asset version query strings to prevent Telegram WebView from reusing mismatched stale assets. Add JS runtime error display and server health/version diagnostics.
- Preserve market analyzer, 200 closed-candle warmup, Twelve Data source, fail-closed stale-data behavior, 40-second hold, alert timing, manual-only trading and separate Android/OCR branch.
- A review pass also ensures the fallback sends an immediate lease heartbeat when it switches to polling, so the server cannot expire the scan before the first periodic heartbeat. Added an end-to-end Node integration smoke test that starts the real Express service and exercises root HTML, no-cache JS asset, health, HTTP start, heartbeat and stop. Integration tests exposed two deployment-order issues and were used to correct them: removed duplicate Express routes that shadowed the health/version handlers, then served HTML, JavaScript and CSS explicitly with no-store headers (Express static maxAge had overridden the attempted cache header). Build, tests, merge, deployment and external/device acceptance pending. User must use the exact Main Market URL in Telegram's BotFather Mini App/Menu Button configuration if the bot still points to an older URL; no BotFather credential is present in this project connection.


### HTTP fallback release — verification checkpoint (2026-11-02)

- PR #7 merged to `main-market`; merge commit: `e5bd1144e389fa726503c9f19f60a9dfbcdfacd8`.
- GitHub Actions Main Market Checks run #85 succeeded. `npm install` postinstall and explicit `npm test` both completed; 15 tests passed / 0 failed. `npm install` postinstall also completed `node --check` for server.js, public/app.js, src/twelve-data.js and src/analyzer.js.
- Added real HTTP integration smoke test: starts the Express service locally in CI, checks `/`, `/health` version, `/app.js`, `/styles.css` and no-store cache headers, then exercises POST start, heartbeat and stop; all passed.
- Render deployment `dep-dbk0r3tg1s2s738g0vn0` for merge commit reached status `live`; build ended `succeeded`; runtime logs confirm `MAIN MARKET single-pair Radar listening on 10000` and Render says `Your service is live`.
- New client transport behavior: WebSocket remains preferred; if it fails to open within 8 seconds or disconnects, the app switches to HTTPS state polling every 2 seconds and POST control for start/select/stop. The fallback renews a 12-second lease immediately and every 5 seconds; server stops monitoring after the client disappears. This retains scan-only-while-Mini-App-open semantics.
- HTML root, `app.js` and `styles.css` are explicitly served with `Cache-Control: no-store`; asset query versions are changed to `20261102-http-fallback`. Added visible runtime JS error reporting and a health version field.
- Market analyzer and strategy unchanged: 200 closed-candle warmup, Twelve Data, stale-data fail-closed behavior, signal hold and alert rules; no broker order placement. Android/OCR branch untouched.
- Render service is active/not suspended, branch `main-market`, auto-deploy enabled. The deploy event and process startup are verified. Assistant network still cannot resolve/fetch the public Render domain, so direct external browser GET and Telegram/Xiaomi rendering cannot be independently verified here. Post-deploy Render error-log query returned no entries in the queried interval.
- No BotFather token/config access is available in this connection. If the Telegram bot's Menu Button / Mini App still points to an older URL, set it to exactly `https://ai-signal-radar-main-market.onrender.com/`. Do not assume the bot's saved URL was changed by the Render deploy.
- User-side final acceptance remains necessary: fully close Telegram, reopen the bot Mini App and press Start. If the user still sees an old page or blank screen, capture the visible URL/title/error; this will distinguish a BotFather URL mismatch from a device WebView issue. Do not report device acceptance until confirmed.


### Mini App interaction fix — non-blocking Telegram SDK (2026-11-02)

- User reported that the Mini App page rendered but pair selection/start/stop and sound/vibration test controls did not respond; connection remained OFFLINE.
- Code inspection found the Telegram WebApp SDK was loaded as a parser-blocking synchronous external script in the document head. If Telegram's CDN is slow/unavailable inside the WebView, the browser can pause parsing before it reaches the app script at the bottom of the page, leaving every control inert. This is a strong code-level cause consistent with the reported symptoms; device reproduction is still pending.
- Changed Telegram SDK to async so the app's own JavaScript can initialize independently. Telegram WebApp access is now looked up lazily, and SDK-specific calls are optional-safe.
- Audio test tone volume/duration increased, and audio unlock is attempted on pointerdown for Start and Test Sound while still requiring a real user gesture. Startup/runtime JS errors are reported immediately.
- Added a visible client boot-ready status and regression test for non-blocking SDK loading.
- Cache-busting version: 20261102-nonblocking-sdk. Market strategy, Twelve Data, server scan lease, and manual-only order safety are unchanged. Must verify CI, deploy, and real Telegram/Xiaomi interaction before calling device acceptance complete.


## 2026-11-02 — Main Market sound and vibration alert correction

- Scope: branch `main-market` only. Android/OCR branch `main` was not changed.
- Source commits:
  - `61ff3c462f5e72f975bab84327472e79800f57dc` — make pre-candle sound and vibration directional-only.
  - `4a62785ec6812d036dea0a100d2d36995a086388` — add regression assertions for CALL/PUT-only pre-alerts and haptic feedback.
- Changes in `main-market/public/app.js`:
  - The 10-second warning now only fires when the selected pair has CALL or PUT and API status is ONLINE; STANDBY stays silent.
  - Both 10-second warning and 3-second entry-preparation alerts request vibration as well as sound.
  - Telegram HapticFeedback notification API is preferred (success for signal, warning for preparation), then impact API, then browser `navigator.vibrate` fallback.
  - Device test status distinguishes Telegram haptics from browser vibration and reports unsupported/blocked feedback.
- Added a regression test in `main-market/test/analyzer.test.js` for directional-only alerts and both haptic pathways.
- Current source head before this documentation update: `4a62785ec6812d036dea0a100d2d36995a086388`.
- Pending verification: GitHub Actions test run and Render auto-deploy for the latest code; actual audible output and physical vibration must still be confirmed on the user's Android device inside Telegram. Browser/Telegram APIs can report that a request was sent but cannot prove the phone physically vibrated or that media volume is audible.
- Important outstanding blocker from prior audit: `POST /api/control` and `GET /api/state` do not yet have Telegram `initData` authentication. No BOT_TOKEN availability was verified because Render does not expose secret values through the available service inspection. Do not expose or hardcode tokens; secure the endpoints before calling the service production-ready.
- Market-feed limitation remains: directional output requires a fresh Twelve Data streaming tick; REST resync alone cannot guarantee precise 10s/3s timing. Six pairs are selectable one at a time, but each pair's Twelve Data entitlement must be verified individually.


### Verification result — Main Market feedback fix (2026-11-02)

- Regression test source correction: `1c0aefdf3310c27cd5a4f5dcab79440a34335f85` (the initial test commit had an escaped newline; corrected before successful build).
- GitHub Actions run `41389059005` completed successfully for commit `1c0aefdf3310c27cd5a4f5dcab79440a34335f85`; install and all 17 tests passed, 0 failed.
- Render deploy `dep-dbk14q7avr4c73cjp4mg` for the same commit reached status `live`; Render build logs show 17 tests passed / 0 failed and Build successful.
- Public `/health` endpoint could not be fetched from the assistant's web runtime; Render deployment state is verified, but HTTP response content and actual Telegram WebView/device behavior are not independently verified.
- Next device check: open the Main Market Mini App, enable both sound and vibration, tap Start once to unlock audio, then use the in-app Test Sound and Test Vibration controls. Confirm the 10-second warning and 3-second entry alert only occur on CALL/PUT; STANDBY must remain silent. Check phone media volume and Telegram's haptics setting if the test controls report sent but no physical feedback is perceived.
- Do not consider security closed: Telegram `initData` validation for `/api/control` and `/api/state` is still outstanding. Also, actual live Twelve Data tick reception and supported status per selected pair still require a real client session.


## 2026-11-02 — Root static Mini App cross-origin API support

- Root static site now hosts a copy of the Main Market client; it calls this service cross-origin from `https://ai-universal-signal-radar.onrender.com`.
- Added explicit allowlist CORS middleware in `main-market/server.js` for the root static-site origin and canonical Main Market origin. It allows GET, POST, OPTIONS and Content-Type, handles preflight, and does not enable credentials or wildcard origins.
- Commit: `779f856e376134515142d89c2dbfb0980f6139f8`.
- This enables the root-hosted UI to call `/api/state` and `/api/control` on the Main Market service and connect to its `/live` WebSocket.
- Security caveat remains: CORS is not authentication. The control and state endpoints still need Telegram `initData` validation and appropriate rate/session protections before the service can be considered production-secure. No bot token was added to public source or browser code.
- Verify Render deploy and actual preflight/API responses from the static-site origin before calling the cross-origin path operational. Telegram WebView and physical sound/haptics require device confirmation.


### Idle server status correction — 2026-11-02

- Added `serverOnline:true` to the state snapshot; clients now display `SERVER ONLINE` while the backend is reachable and scanner is idle. During scanning the badge continues to reflect actual Twelve Data feed status.
- Server commit: `e40c0f23b4546ca406cbe49244ca825f89b707c0`; UI commit: `398f1255134f59edc167788fa8f1bd07f9fbb263`; regression test commit: `cc7a6b651eb66dada3e7e2162b1a785fa2be4607`.
- This is only server availability reporting; it does not imply Twelve Data is streaming or that all pairs are supported.
- Pending: latest GitHub Actions, Render deploy, HTTP/CORS preflight, and Telegram device verification.


### Mini App startup crash fix — 2026-11-02

- User screenshot exposed `Uncaught TypeError: values.find is not a function` with OFFLINE status and inert controls.
- Confirmed the canonical client called `setSelected(saved)` at startup while `saved` is a scalar string from localStorage; the function assumed an array and threw before `pollState()` / WebSocket connection initialization.
- Patched `main-market/public/app.js` to normalize scalar/array/null selection values before using `.find()`. Preserves selected pair and one-pair-at-a-time behavior; no server/analyzer strategy changes.
- Client fix commit: `c73c67c925240342ed950d17e7954169ef943e95`.
- Added a regression test verifying persisted scalar selection cannot trigger this startup crash. CI and Render deployment pending; Telegram/Xiaomi device confirmation remains outstanding.


### Separate REST support from live Streaming support — 2026-11-02

- User confirmed EUR/USD works while other selectable pairs report unsupported. Render logs show EUR/GBP successfully loaded REST history, then the Twelve Data WebSocket subscription failed and the backend incorrectly promoted that Streaming failure to an overall pair UNSUPPORTED state.
- Root cause: `feedStatus()` treated any `streamStatus === UNSUPPORTED` as total pair failure before checking whether REST was READY. `analyzeMarket()` also returned early without indicators when there was no live tick, hiding valid REST-derived price/Close/RSI.
- Changed status model: `UNSUPPORTED` now means REST itself is unavailable; `REST_ONLY` means REST history is ready but live Streaming is unavailable. REST_ONLY is API ONLINE for data display, but it never permits CALL/PUT without a fresh tick.
- Analyzer now calculates indicators from at least 200 closed REST candles even without Streaming, exposes `lastPrice`, `metrics.rsi14`, `livePriceReady:false`, and forces STANDBY with an explicit reason until fresh Streaming arrives.
- UI distinguishes REST_ONLY and displays Price, Close, RSI and data age. Stream subscription errors no longer erase usable REST data or mark the REST feed as locked.
- Added regression test for 220 closed candles with no Streaming: indicators and Close must be available while signal remains STANDBY.
- Pair list remains six selectable pairs; no claim that all six have live Streaming entitlement. EUR/USD behavior and analyzer thresholds are preserved. User device acceptance and per-pair Twelve Data Streaming entitlements remain to be verified.
- Code changes in progress; update commit IDs, CI and Render deployment status after verification.


## 2026-11-02 — Confirmed master scope: six pairs, single-pair scanning

- User explicitly confirmed the product scope: support all six pairs — AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD — while selecting/scanning exactly one pair at a time. EUR/USD remains the default.
- This confirmation supersedes any older handoff text that says EUR/USD is the only selectable symbol or that all six pairs should scan concurrently. Historical checkpoints below are retained as history, not current requirements.
- Re-inspected current `main-market` source before recording this decision:
  - `main-market/src/config.js`: `SYMBOLS` contains exactly the six requested pairs; `DEFAULT_SYMBOLS` contains only EUR/USD; `REST_SYNC_SECONDS=300`.
  - `main-market/server.js`: server enforces a single selected symbol on Start, accepts a single-pair `select` action, closes the prior stream, clears prior signal context, and starts history/stream work for the chosen pair.
  - `main-market/public/app.js`: compact selector persists one selected pair and sends one symbol on Start; changing the pair while monitoring sends a single-pair select action.
  - `main-market/test/analyzer.test.js`: regression assertions cover the exact six-symbol list, EUR/USD default, one-pair selection, and 300-second REST refresh.
- No market calculation or UI code change was required for this confirmation: the current source already implements the confirmed selection model. This checkpoint updates the authoritative project requirements and handoff only; it does not claim new runtime or provider capability.
- Important distinction: listing a pair in the selector does not prove the user's Twelve Data account supports REST history or live WebSocket prices for that pair. Each selected pair must be checked at runtime. REST-only data may display price/Close/RSI, but CALL/PUT remains blocked without a fresh live Streaming tick; unsupported, stale or unconfirmed feeds remain STANDBY.
- Current technical baseline visible in source: 200 fully closed 1-minute candles required, request 220 historical bars, REST resync every 300 seconds, fresh Streaming tick required for directional output, manual-only trading, no broker order placement, no OCR/OTC.
- Files changed in this checkpoint: `PROJECT-HANDOFF.md` only.
- Validation status: source inspection confirms the six-pair configuration and single-pair enforcement; no new automated test/build/deploy was triggered by this documentation-only update. Existing tests in source cover the selection contract, but this checkpoint does not claim a fresh test run, Render deployment, external HTTP check, or Xiaomi/Telegram device test.
- Next PM steps: run the branch's full `npm test` and syntax-check/build pipeline; inspect current Render deployment state; confirm live REST/Streaming entitlement one pair at a time (especially EUR/USD baseline, then the other five); verify pair switching, signal invalidation, countdown/alerts, and actual device behavior. Record each pair as REST-supported / Streaming-supported / REST-only / unsupported / not yet verified; never infer support from selector presence.


---

## 2026-11-02 — User-authorized MAIN MARKET v2 rewrite (candidate checkpoint)

The user explicitly authorized a complete rewrite: “ผมอนุญาตให้คุณเขียนครับใหม่ทั้งหมด”. Scope was confirmed as MAIN MARKET only. The existing Android/OCR project on `main` must remain untouched.

### Isolation and source control
- Created isolated branch: `rewrite/main-market-v2`, based on `main-market`.
- Opened draft PR #9 to `main-market`: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/pull/9
- Latest candidate commit: `15dabf2f35a745b8464312411c5ac473d6fa75dc`.
- Production branch `main-market` has not been merged or modified by this rewrite. Android/OCR branch `main` was not changed.
- Candidate changed 10 files: `main-market/REWRITE-PLAN.md`, `main-market/src/config.js`, `main-market/src/analyzer.js`, `main-market/src/twelve-data.js`, `main-market/server.js`, `main-market/public/index.html`, `main-market/public/styles.css`, `main-market/public/app.js`, `main-market/test/analyzer.test.js`, and `.github/workflows/main-market-v2.yml`.

### Implemented on the isolated candidate
- Replaced runtime configuration with the six confirmed Non-OTC pairs, one selected pair at a time, EUR/USD default, M1, 200 closed-candle warmup, 220-bar REST request, 300-second REST refresh, 25-second live tick freshness limit and 40-second signal hold.
- Rebuilt Twelve Data REST parsing: pair allowlist, request timeout, provider error classification, OHLC validation, UTC timestamp parsing, duplicate timestamp removal, chronological sorting and exclusion of the current unclosed candle.
- Rebuilt the evidence/decision engine: EMA 9/21/50, RSI14, MACD, ATR, volatility, recent momentum, candle structure and support/resistance; recognizes trending, ranging, high-volatility, reversal and unclear regimes.
- Analyzer rejects malformed OHLC, duplicate/reversed timestamps, stale history and gaps among the latest five M1 bars. Older historical market-closure gaps are tolerated. REST history can show indicators, but CALL/PUT requires a fresh Streaming tick. The engine is transparent rule-based logic, not a trained ML model; no predictive edge or win rate is claimed.
- Rebuilt Node service around one server-enforced selected pair, separate REST/Streaming state, HTTP/WebSocket transport, client lease, fail-closed handling, signal hold, invalidation and per-candle deduplication.
- Rebuilt mobile Mini App layout and pair selector, live signal lamp, market regime/evidence, price/Close/RSI/EMA display, candle countdown, start/stop, sound/vibration and 10s/3s directional-only alerts.
- Added a fresh regression suite and a v2-specific workflow.

### Automated verification
- GitHub Actions Main Market Checks run `41395675719`: **success**.
- GitHub Actions Main Market v2 Rewrite Checks run `41395675750`: **success**.
- Logs for run `41395675719` show `npm install` succeeded and `npm test` completed with **13 tests passed, 0 failed**. The v2 workflow's syntax-check step also completed successfully for server, config, analyzer, Twelve Data client and browser client.
- The HTTP smoke test starts the Express service and verifies root HTML, health, start, heartbeat and stop control paths.
- These checks apply to the candidate commit `15dabf2f35a745b8464312411c5ac473d6fa75dc`.

### Not yet done / release blockers
- PR #9 is still a draft and has not been merged. Render remains connected to `main-market`; the candidate has **not** been deployed. No production service was changed by this rewrite.
- The assistant runtime cannot reach GitHub over direct network from its local container; verification was performed through GitHub Actions. No local clone/build was claimed.
- Live Twelve Data REST and Streaming entitlement for each of the six pairs has not been retested against the user's actual key. Provider WebSocket subscribe responses and live ticks remain unverified on this candidate.
- Public control/state endpoints still need Telegram `initData` authentication (or another approved authenticated session design) before production promotion. Rate limiting and CORS are not authentication. Do not claim production security.
- Physical sound and vibration on Telegram WebView / Xiaomi 11T remain unverified.
- No historical backtest, paper-trading, latency, false-positive or out-of-sample predictive validation has been run. Do not label the system Production-Ready.
- No secrets or API keys were added to the repository or client code. No paid resources were created.

### Next PM actions
1. Review candidate server/client lifecycle and close the Telegram authentication/security gap before promotion.
2. Add provider WebSocket protocol fixtures/integration tests and verify REST/Streaming separately for each pair with the user's live account.
3. Verify latest PR checks remain green after any further edits, then request promotion only after security review.
4. After an approved merge, inspect Render deployment and verify health/runtime logs. Finally test Telegram WebView and physical alerts on Xiaomi 11T.


### Follow-up fixes and final candidate verification — 2026-11-02

- Follow-up review fixed three UI/runtime edge cases on the rewrite branch:
  - Bound the feed-status element referenced by the client, preventing a null-element render exception.
  - When the app is idle, synchronize the saved local pair with the server's selected pair before showing that pair's market data; ignore a stale idle snapshot for a different pair.
  - Keep the next-M1 countdown aligned to the next clock minute even before the first live tick arrives.
- Signal lifecycle hardening: if evidence reverses during the 40-second hold, cancel to STANDBY and retain the candle dedupe marker so an opposite signal cannot immediately fire on the same closed candle.
- Stale feed, data error and unsupported REST states now map to API LOCKED while scanning; REST_ONLY remains data-display ONLINE but directional output remains blocked.
- Added regression assertions for saved-pair synchronization, the feed-status element and the health interval field.
- Final code commit tested: `e1056d9ab8f978dcf7410f30b8fb8c1b1a8aefc6`.
- Final candidate CI:
  - Main Market v2 Rewrite Checks run `41395902930`: **success**, including install/test and all syntax checks.
  - Main Market Checks run `41395903066`: **success**; logs show **13 tests passed, 0 failed**.
- The subsequent handoff documentation commit is `983f0cb02ebbcdbe72df7a585073f842bc23a502`; it changes documentation only. The validated application code remains the preceding tested commit.
- PR #9 remains draft/unmerged. No Render deployment or production branch update has occurred.
- Remaining release blockers are unchanged: Telegram `initData` authentication, actual Twelve Data REST/Streaming verification per pair, physical Telegram/Xiaomi sound/haptics, and historical/out-of-sample market validation.



## 2026-11-02 — Telegram Mini App authentication implemented on v2 candidate

- Implemented server-side Telegram Web App `initData` validation in `main-market/src/telegram-auth.js` using Telegram's HMAC-SHA256 verification algorithm, timing-safe hash comparison, duplicate-field rejection, mandatory user ID, 24-hour maximum age and 60-second future-clock tolerance.
- Added `POST /api/auth` which exchanges valid initData for a cryptographically random, four-hour, HttpOnly, Secure, SameSite=Lax session cookie. Authentication requests are rate-limited. Session records are kept server-side and expired sessions are periodically removed.
- Protected `GET /api/state` and `POST /api/control` with the session middleware. Protected WebSocket `/live` during the HTTP upgrade; unauthenticated upgrades receive HTTP 401. No initData or session token is placed in a WebSocket URL or application log.
- Mini App now requires Telegram's raw `WebApp.initData` before polling, connecting or issuing controls. When opened outside Telegram or when verification fails, the controls stay disabled and the UI displays an authentication/locked message.
- Health endpoint exposes only non-sensitive service metadata. JSON body limit increased to 8 KB for Telegram initData payloads.
- Added tests for valid signature, tampering, expired/future auth dates, missing bot token, unauthenticated HTTP state/control, unauthenticated WebSocket rejection, authenticated WebSocket, and authenticated start/heartbeat/stop.
- Latest validated application code commit: `1c6fc8254820fef736ddd333cbc8f3ac12d89422`.
- The server also accepts the legacy `BOT_TOKEN` environment variable as a fallback, while `TELEGRAM_BOT_TOKEN` is the documented preferred name. `.env.example` now lists `TWELVE_DATA_API_KEY`, `TELEGRAM_BOT_TOKEN` and `PORT` only.
- GitHub Actions results for the final application code commit:
  - Main Market Checks run `41397415865`: **success**, `npm test` reports **14 passed / 0 failed**; syntax checks passed.
  - Main Market v2 Rewrite Checks run `41397415903`: **success**, `npm test` reports **14 passed / 0 failed**; syntax checks passed for server, config, analyzer, Twelve Data client, Telegram auth module and browser client.
  - Both install workflows reported **0 npm vulnerabilities**.
- PR #9 remains **Draft / open / unmerged**. Render production service remains attached to branch `main-market`; no v2 code was deployed and no production branch was changed.
- Release blocker: production must have `TELEGRAM_BOT_TOKEN` configured as a private Render environment variable before the new Mini App can authenticate. No bot token has been supplied or confirmed in the project context. Do not ask the user to paste it into chat or commit it to GitHub. Set it only in the Render Dashboard after the user has access to BotFather's token.
- Still not verified: real Twelve Data REST and Streaming entitlement for all six pairs using the user's live API key; Telegram WebView cookie/session behavior on Xiaomi 11T; actual sound/vibration and 10s/3s timing on device; historical/backtest and out-of-sample predictive performance. The rule engine remains heuristic and must not be marketed as a proven predictive AI.
- Promotion policy: do not merge PR #9 or point the production Render service at this branch until the bot token is configured privately and the live provider + Telegram device gates are passed. Existing `main-market` production and Android/OCR `main` remain preserved.



### Production provider observations from Render logs — 2026-11-02 (legacy main-market deployment)

- These observations are from the existing production service running the older `main-market` branch, not from the v2 candidate.
- During the single-pair checks around 05:17–05:29 UTC, the old service logged successful REST history loads of 220 requested / 220 available / 200 required for GBP/JPY, EUR/GBP, GBP/USD and AUD/USD. For those same attempts the Twelve Data Streaming subscription was rejected as unsupported.
- EUR/USD logged a successful first live Streaming price in the same period.
- EUR/JPY appears in earlier multi-pair production logs with Streaming reported unsupported; a fresh single-pair REST result for EUR/JPY was not established in the latest log window.
- This confirms why v2 separates REST-only from Streaming: a pair may display REST-derived Price/Close/RSI while remaining STANDBY for direction until a fresh live tick is available. Do not infer live signal capability from successful REST history or selector presence.
- This is legacy-service evidence only; repeat the per-pair check against the v2 candidate after it is deployed with the private secrets configured.


### User confirmation — existing Render Telegram bot token — 2026-11-02

- User confirmed in chat that the Main Market Render service already has a Telegram bot token configured.
- The v2 server reads `TELEGRAM_BOT_TOKEN` first and falls back to the legacy `BOT_TOKEN` variable. Therefore either existing variable name is supported by the candidate code; no new token needs to be sent in chat.
- The assistant cannot inspect secret environment-variable names/values through the available Render service metadata. Record this as user-confirmed presence, not independently verified environment configuration. Do not expose or request the secret.
- Deployment check still required: confirm the Telegram Mini App URL opens the Main Market service origin (`https://ai-signal-radar-main-market.onrender.com`) because this candidate uses same-origin relative `/api/auth`, `/api/state`, `/api/control`, and `/live` paths with an HttpOnly session cookie. A separate static-site origin would need a deliberate credentialed CORS/API/WebSocket design; do not assume the old cross-origin static copy works with this session implementation.
- No production deployment or PR merge is authorized by this confirmation alone. Keep PR #9 Draft until same-origin Mini App routing, actual provider access for each pair, and Xiaomi/Telegram device checks are complete.


### Release gate recheck — 2026-11-02 (after user confirmed BOT_TOKEN exists)

- Re-fetched PR #9: open, Draft, not merged; base `main-market`; head `rewrite/main-market-v2`; current PR head is the documentation checkpoint `bab1da5b01bba608635bb65ff328d5af7b5de532`.
- Re-fetched Actions for application commit `1c6fc8254820fef736ddd333cbc8f3ac12d89422`: Main Market Checks run `41397415865` and Main Market v2 Rewrite Checks run `41397415903` both completed successfully. PR head subsequently changed only for documentation; no app-code changes since that validated application commit are recorded in this checkpoint.
- Render production service `ai-signal-radar-main-market` is still configured to branch `main-market`, Auto Deploy on commit. Latest deploy `dep-dbk1mv5h3lcs738poeq0` is Live for production commit `0f046d986da825efc0272cf763ca45d8e91e77d3` (documentation-only commit). This is the existing production deployment, not the v2 candidate.
- Render service metadata does not expose environment-variable names or values. User confirmed BOT_TOKEN exists, and candidate code supports both `BOT_TOKEN` and `TELEGRAM_BOT_TOKEN`; actual variable-name presence cannot be independently read through available Render tools.
- Attempted direct public `/health` check through available web retrieval; endpoint was not accessible through that retrieval tool. No HTTP success is claimed from that attempt.
- Render error-log query returned historical npm-test failures dated 2026-11-02 00:37–04:32 UTC; these precede the latest live deployment at 05:12 UTC. They are historical build/app errors, not proof that the current live deployment is failing. Request-log query returned no records in the queried range. Recheck latest app logs after any controlled runtime test.
- Critical operational dependency: PR #9's candidate uses same-origin relative API paths and a Secure HttpOnly cookie. It must be served from the Main Market Render origin, not an unrelated static-site origin. Telegram Mini App URL configuration is external to this GitHub repository and has not been independently inspected.
- No merge, production branch change, environment-variable mutation, or deployment of v2 was performed in this checkpoint.


### Telegram Mini App URL discovery and cross-origin auth correction — 2026-11-02

- Do not ask the user to provide the Mini App URL again. It was found in the connected GitHub repository and Render workspace.
- Render Static Site service `AI-UNIVERSAL-SIGNAL-RADAR-` (`srv-dbjhmeutlv9c73d8m9q0`) is configured from repository branch `main`, rootDir empty, publishPath `.`, auto-deploy on commit; public UI URL: `https://ai-universal-signal-radar.onrender.com`.
- Render Node Web Service `ai-signal-radar-main-market` (`srv-dbjls149v7es73ag0k4g`) is configured from branch `main-market`; canonical API/WebSocket origin: `https://ai-signal-radar-main-market.onrender.com`.
- Root `index.html` and `app.js` on branch `main` contain the complete Main Market Mini App UI and explicitly call the canonical Node API over cross-origin HTTPS and WSS. The project handoff documents this as the current Main Market Mini App. This is the configured project UI origin, though the BotFather-side Telegram URL value itself is not exposed by GitHub/Render tools.
- Previous v2 auth implementation incorrectly assumed same-origin paths/cookies. Corrected candidate branch `rewrite/main-market-v2` only:
  - client uses explicit `API_ORIGIN=https://ai-signal-radar-main-market.onrender.com` for auth, state, and control requests;
  - all credentialed fetches use `credentials: include`;
  - WebSocket connects to the canonical API host, not the static-site host;
  - server returns `Access-Control-Allow-Credentials: true` for exact allowlisted origins, including the static Mini App origin;
  - v2 workflow now asserts these cross-origin auth/session wiring requirements.
- This is a source-level correction, not a live browser/Telegram verification. CI must pass after the final patch; actual Telegram WebView cookie behavior still requires runtime validation after a controlled deployment.
- Keep PR #9 Draft and do not merge/deploy until CI passes and release checks are complete. Do not alter branch `main` or production branch `main-market` in this fix.


### Cross-origin credential propagation follow-up — 2026-11-02

- Candidate client now sends `credentials: "include"` on all three authenticated HTTP operations: POST `/api/auth`, GET `/api/state`, and POST `/api/control`. WebSocket now targets the canonical API host, so the API-host session cookie is sent on the socket handshake.
- Candidate server returns `Access-Control-Allow-Credentials: true` only when the request Origin is in the exact allowlist (or is the API's own origin). The allowed list contains the verified static Mini App origin and canonical API origin. No wildcard origin is used.
- v2 workflow now checks the explicit API origin, WebSocket target, exact static origin allowlist, credentialed CORS header, and at least three credentialed fetches.
- GitHub Actions for app-code commit `548f60161d54cae426869b55399e13c737bd8d6b`: Main Market Checks run `41398658621` and Main Market v2 Rewrite Checks run `41398658722` both completed successfully. The later workflow-only assertion update `a04be1752557a8a1fff00613bdbc40973dd40a02` has not yet been independently confirmed by a returned Actions run; do not claim that additional grep assertion itself passed until its run is visible.
- PR #9 remains Draft and unmerged. No Render deployment has been made for the candidate. Runtime cookie/CORS/WebSocket behavior in Telegram WebView is still unverified.


## 2026-11-02 — 60-candle warmup and stronger vibration correction

- User reported that the Mini App played sound but vibration was absent, and asked to reduce the REST warmup from 200+ bars if needed so the app can be run.
- Changed candidate configuration on `rewrite/main-market-v2`:
  - Minimum closed M1 candles: **60** (previously 200).
  - Twelve Data REST request: **80** bars (previously 220).
  - Internal candle buffer: **100** bars (previously 260).
  - REST refresh remains 300 seconds (about 288 requests/day for one selected pair if continuously active), and only one selected pair is requested at a time.
- 60 bars are sufficient for the configured EMA50, RSI14, MACD(12,26,9), ATR14/20 and recent 20-bar range calculations. The analyzer still rejects malformed OHLC, duplicate/out-of-order timestamps, stale data and gaps among the most recent five M1 bars.
- Server state now reports the configured minimum (60) instead of a hard-coded 200. REST history can display indicators, but CALL/PUT still requires an actual fresh Streaming tick no older than 25 seconds; REST-only pairs remain STANDBY.
- Strengthened haptic alert handling: directional signals use Telegram `HapticFeedback.impactOccurred("heavy")` plus `notificationOccurred("success")`; 10-second/3-second preparation alerts use medium/heavy impact plus warning notification. Android browser vibration remains the fallback when Telegram HapticFeedback is unavailable. The existing vibration toggle and test button remain enabled by default.
- Added WebSocket Origin allowlist enforcement matching the credentialed CORS origins. The approved static Mini App origin and same-origin API are accepted; foreign browser origins are rejected with HTTP 403 before session handling.
- Added regression tests for 60-bar indicator readiness, 59-bar STANDBY, the 80-bar REST cap, vibration methods, approved Mini App WebSocket origin and rejected foreign origin.
- Updated v2 CI assertions to enforce the 60/80 settings, both haptic methods and WebSocket origin guard.
- Code commits in this change set:
  - `60412859804ea1617bf3b86e3e541ea5d44807e` — 60/80/100 candle configuration.
  - `d7108f5f1cc0126bc21dd1a00b63984cf4507684` — candle threshold and indicator tests.
  - `5ae340798baaa4adbd1df150d7509e6756ed4206` — stronger vibration/haptic handling.
  - `e366329330c99a9a9bbb1d684e0e9013eec58084` and `1a0da85aa378e5cb1ade495dfcabb66d5c320e03` — WebSocket origin restriction and correct HTTP rejection framing.
  - `fd5ba92d42746f558753d2614e48c689dca7d6cf` — origin and haptic regression coverage.
  - `d13d5fd5742defafd23ad76b74c31f32bf2ebbc2` — expose actual 60-bar requirement in server state.
  - `9d805c2f6b66aa1a8ab7d5403e8966c56cc0bffc` — CI assertions.
- Validation still pending at this handoff update: latest GitHub Actions run for the combined code changes; controlled Render deployment; real Twelve Data REST/Streaming checks on the configured account; Telegram WebView cookie/session behavior and physical vibration on a handset. Do not claim these are live-tested until evidence is collected.
- Production protection: no PR merge, Render branch change, or production deployment was performed in this change set. Existing `main-market` and Android/OCR `main` remain untouched.


## 2026-11-02 — Main Market v2 production promotion and Static Mini App sync

### Release source and CI
- PR #9 was marked ready and squash-merged into `main-market`.
- Merge commit: `eca36f92541e0dd38ec8a9a66e3e65afd46310b7`.
- Latest candidate CI before merge:
  - Main Market Checks run `41400652463`: **17/17 passed**, 0 failed, 0 npm vulnerabilities.
  - Main Market v2 Rewrite Checks run `41400652474`: **17/17 passed**, including syntax checks and cross-origin, 60/80 candle and haptic assertions.
- The prior v2 workflow failure was only a quoting defect in the CI credential-count grep. The workflow assertion was corrected and the latest run passed.

### Render deployment — verified
- Existing Node API service `srv-dbjls149v7es73ag0k4g` remains on branch `main-market`, Singapore, Free plan, Auto Deploy on commit.
- Deploy `dep-dbk2u62vcj2c73fitnj0` for merge commit `eca36f92541e0dd38ec8a9a66e3e65afd46310b7` reached **live**.
- Render events confirm build succeeded and deploy ended with `deployStatus=succeeded`.
- Render logs confirm the service ran `cd main-market && npm start` and printed `MAIN MARKET v2 listening on 10000`; Render then reported “Your service is live”.
- Render build logs show the install-time suite completed with **17 tests passed / 0 failed**, and npm reported **0 vulnerabilities**.

### Static Mini App UI — verified deploy
- Existing Static Site `srv-dbjhmeutlv9c73d8m9q0` remains on branch `main`, publish path `.`, URL `https://ai-universal-signal-radar.onrender.com`.
- Synced only the three root frontend assets from the merged `main-market/public/` directory to the existing Static Site branch `main`:
  - `index.html` commit `8e55f0207e91b372f2a52da7e29630cf15ad2465`
  - `app.js` commit `5ec029cecdfd5476ac7ee42e1bb7e2ced65bd171`
  - `styles.css` commit `8bbcaea811e7d7ea69204dca4a4882f92c2387f9`
- Final Static Site deploy `dep-dbk2uoeq1p3s73bbbn4g` for commit `8bbcaea811e7d7ea69204dca4a4882f92c2387f9` reached **live**; Render events show build and deploy succeeded.
- The Android/OCR project files were not edited. Only the Main Market root Mini App HTML/CSS/JS assets were replaced on `main`.

### Current runtime contract
- Minimum closed M1 candles: **60**.
- Twelve Data REST request: **80** bars.
- Internal buffer: 100 bars; one selected pair at a time; REST refresh 300 seconds.
- EMA 9/21/50, RSI14, MACD(12,26,9), ATR14/20 and recent range are calculable with 60 closed bars.
- CALL/PUT still requires a fresh Twelve Data Streaming tick no older than 25 seconds. REST-only, stale, malformed or unsupported feeds remain STANDBY. Previous legacy production logs showed EUR/USD Streaming available while several other pairs were REST-only; re-test current v2 account entitlement per pair.
- Telegram initData HMAC validation and session-cookie protection are enabled. Server reads `TELEGRAM_BOT_TOKEN` or legacy `BOT_TOKEN`. User confirmed an existing Render bot token; Render metadata does not expose secret names/values for independent inspection.

### Still awaiting real-user runtime confirmation
- The Render control plane confirms both services are live, but the assistant's web retrieval environment could not fetch the public Render URLs; do not claim independent external HTTP browser verification.
- No authenticated Telegram Mini App client has yet been observed connecting to the new API after promotion. The user must reopen the existing Telegram Mini App so the new static assets load, then test Start/Stop and the vibration test button.
- Physical vibration depends on Telegram/device haptics settings and Android WebView support; CI verifies code paths, not physical device response.
- Actual Twelve Data REST/Streaming responses for all six pairs have not yet been captured on v2. REST success alone does not authorize CALL/PUT.
- No backtest, paper-trading, or out-of-sample predictive edge has been established. Manual trading only; no broker orders.


### Indicator-history refinement after release — 2026-11-02
- Follow-up inspection found that the 80-bar REST response was fetched but the analyzer only retained the minimum 60 bars for calculation.
- Corrected `main-market/src/analyzer.js` to require 60 closed bars but retain up to `HISTORY_CANDLES=80` for EMA/MACD/ATR and range context. This preserves the shorter warmup while using the full requested history for better indicator initialization.
- Added a regression test proving both 60-bar minimum readiness and 80-bar context use.
- Commits: `3e035c3aece718e367dd6d1270fc155f50fd9f2c` (analyzer); `3a5b305145acc1da2748ff8799fd938541dc0060` and `6fcdae49880e1a2ab6c53001b8a70af14688c8af` (tests).
- Render deploy `dep-dbk2vs8gbm7c7386j8q0` for code commit `6fcdae49880e1a2ab6c53001b8a70af14688c8af` reached **live**. Render build logs confirm **18/18 tests passed**, 0 failed, 0 npm vulnerabilities, and the Node process started successfully. Static Site remains live on the already-verified v2 UI; no frontend change was required for this analyzer-only refinement. The latest handoff-only commit may trigger another same-code API redeploy.


## 2026-11-02 — Critical Mini App boot-order and pre-alert fixes

### Root cause found
- User correctly reported that a successful build/deploy did not mean the product worked end-to-end.
- Inspected the actual Static Site HTML and found the Telegram WebApp SDK was included with `async`. The app's bottom-of-page initialization could run before the asynchronous Telegram SDK, read `window.Telegram.WebApp.initData` as missing, disable Start/Stop and never attempt the API authentication request.
- This was a real launch-order defect, not a phone-model issue. Fixed by making Telegram SDK a synchronous script loaded before `app.js`, and bumped the client cache version to `20261102-v3`.
- Verified root Static Site `app.js` is byte-for-byte identical to the API-source `main-market/public/app.js`, and root HTML has the synchronous Telegram SDK script before app.js.

### Alert timing defect found
- Previous UI pre-candle alerts checked the currently displayed `feed.signal`. The signal is intentionally held for 40 seconds, while 10-second/3-second pre-candle alerts happen near the 60-second candle close; a valid signal could expire before the pre-alert window.
- Added server-side `preAlertSignal` scoped to the current closed-candle ID. It retains the validated CALL/PUT direction for that candle after the 40-second display hold, clears on candle change or invalidation, and is included in the public state.
- Client pre-alert logic now uses `preAlertSignal`, while the visible signal still respects the 40-second hold and per-candle dedupe. This preserves the original hold duration and makes 10s/3s warnings possible.
- Added a regression test for 10s/3s pre-alert behavior after the 40s display hold.

### Runtime diagnostics
- `/health` now reports safe booleans for Telegram token and Twelve Data key presence (never values), minimum/history candle counts, REST refresh cadence and whether Streaming is required for directional signals.
- Added sanitized logs for Telegram authentication rejection/success and scan-start requests; no initData, cookies, Telegram user IDs or secret values are logged.
- These logs allow checking whether the actual Telegram Mini App reaches the backend and whether auth succeeds, instead of relying on build status.

### Deployed
- Static Site branch `main`:
  - Telegram SDK load-order fix commit `4ca5ff0c0ba0fdad9ab8347df49005c035bcb72b`, deploy `dep-dbk32r15efls73ejgga0` succeeded.
  - Latest client sync with pre-alert fix commit `260f7fb0bdd2b157d822ebee4ab90b85426ceae4`, deploy `dep-dbk33mjm8hqs738cddr0` succeeded/live.
- API branch `main-market`:
  - Pre-alert direction persistence commit `d5c6241ce721f039e79dc4713ceef4727fc0ca8e`, deploy `dep-dbk33e2vcj2c73fj31kg` succeeded/live.
  - UI pre-alert client commit `493346f1336a92a2e5f6a7c0f12fb63d1d4ccf6c`, deploy `dep-dbk33gaqphnc73eduod0` succeeded/live.
  - Safe health/auth diagnostics commit `db8c1a5fb272120fcf2c72e376677cb0f8bccb68`, deploy `dep-dbk33uogbm7c7386m3ug` succeeded/live.
  - Latest health endpoint assertions commit `85a51cb6b3898c26f81554b4f08596bf74ca93d4`, deploy `dep-dbk3427dnq4s73edn69g` succeeded/live.
- Latest observed Render build executed `npm test`: **19 tests passed, 0 failed**; npm reported 0 vulnerabilities.
- The API server process starts successfully and Render reports the service live. Static Site and API now carry the same v3 client assets.

### What remains unproven (do not overclaim)
- Render's request-log/metrics query returned no request records/data for the new API after deployment, so an authenticated Telegram WebView session, successful live auth, actual REST call on the current deployment and live Streaming ticks are **not yet evidenced**.
- The Telegram Mini App URL configured in BotFather is an external setting not readable through the connected GitHub/Render interfaces. Do not assume it points to `https://ai-universal-signal-radar.onrender.com`; previous conversations referenced the older `https://my-ai-signal-bot-v2.onrender.com`. This mismatch may cause Telegram to keep opening an older app.
- The assistant's web/container runtime cannot directly fetch the public Render domains in this environment (DNS/network unavailable), so do not claim an external HTTP smoke test.
- Pair-level Twelve Data entitlement remains account-dependent. REST history and Streaming are separate capabilities. Only a pair with successful REST history and a fresh Streaming tick may issue CALL/PUT under the current safe rule; REST-only pairs remain STANDBY.
- Physical haptics remain dependent on Telegram and Android device support; the code path is present, but no handset vibration has been observed remotely.


### Preserve the previously used Telegram URL — 2026-11-02
- Prior conversation context indicated the Telegram bot had previously been configured to open `https://my-ai-signal-bot-v2.onrender.com`. The current project had moved its Static Site to `https://ai-universal-signal-radar.onrender.com`, creating a risk that Telegram would continue opening an old app.
- To avoid requiring the user to change BotFather settings, created a new Render Static Site alias named `my-ai-signal-bot-v2` in the confirmed Render workspace:
  - Service ID: `srv-dbk35e8ae00c73fmpi30`
  - Branch: `main`, publish path `.`, Auto Deploy on commit.
  - URL: `https://my-ai-signal-bot-v2.onrender.com`
  - Deploy: `dep-dbk35egae00c73fmpjhg` — **live/succeeded**.
- The alias serves the same root Main Market v3 HTML/JS/CSS as the primary Static Site. The client still calls the canonical API `https://ai-signal-radar-main-market.onrender.com`.
- This preserves the previously used Telegram URL without needing BotFather changes, if that remains the configured URL. The primary Static Site `https://ai-universal-signal-radar.onrender.com` also remains live.


### Latest environment audit — 2026-11-02
- Render startup audit for Node service `srv-dbjls149v7es73ag0k4g` confirmed:
  - `TWELVE_DATA_API_KEY` is present.
  - Minimum closed candles = 60; REST history = 80; refresh = 300 seconds.
  - **No environment variable name containing TELEGRAM, BOT or TOKEN exists in this service's process environment** (sanitized name-only audit; no secret values logged).
  - Therefore `TELEGRAM_BOT_TOKEN` / legacy `BOT_TOKEN` is genuinely missing from the current API service, despite prior assumption that a token existed in Render. It may have been configured on an older/different service; the current Node API cannot access it.
- This is now a hard blocker: `/api/auth` returns HTTP 503 without a Telegram bot token, so the new Mini App cannot create a session, start scanning or open the authenticated WebSocket. Do not ask the user to test the app until the token is added.
- Required Render variable name is exactly `TELEGRAM_BOT_TOKEN`; value must be the bot's existing BotFather token. Add it to Node service `srv-dbjls149v7es73ag0k4g` only. Do not place it in the public GitHub repository or share it in chat. After adding, Render will restart/redeploy the service; startup audit should report `telegramBotTokenConfigured: true`.
- The Twelve Data key is present but current-deploy 80-bar REST retrieval and pair-specific Streaming have not yet been exercised because Telegram authentication is blocked.
- Current API source includes sanitized token-variable-name audit commit `b28e2390ccf4227fa61227baf70196114875ea78`; Render deploy `dep-dbk36k7avr4c73clpp40` reached live.
- Legacy Telegram URL alias `https://my-ai-signal-bot-v2.onrender.com` is live at Static Site `srv-dbk35e8ae00c73fmpi30`, deploy `dep-dbk35egae00c73fmpjhg`. Both it and the primary Static Site serve the same Main Market v3 frontend.


## 2026-11-02 — Telegram Mini App API LOCKED / CORS fix
- User reported Mini App opened but showed API LOCKED, disabled Start button, blank market metrics, and a generic browser "Script error".
- Runtime logs confirm the Render Node service started and both TELEGRAM_BOT_TOKEN and TWELVE_DATA_API_KEY are present (presence booleans only; secret values are never logged).
- Root cause found in main-market/server.js: CORS allowlist omitted the legacy Static Site origin `https://my-ai-signal-bot-v2.onrender.com`, although this was the Mini App URL provided to the user. Browser cross-origin POST /api/auth preflight from that origin would be rejected with 403, preventing Telegram initData authentication and leaving the Start button disabled.
- Fix commit: 3c50d1d78e71aac668bbeb157c5b90d0b96d640c — added the legacy frontend origin to the explicit CORS allowlist. This also allows the same trusted origin for the authenticated WebSocket upgrade.
- Render auto-deploy started: dep-dbk3o5qvcj2c73fjm6f0, build_in_progress at 2026-11-02 07:30:32 UTC. Do not tell user to retest until deploy status becomes live/succeeded.
- Still not yet verified: successful OPTIONS preflight from device, /api/auth success, cookie persistence inside Telegram WebView, authenticated /api/state, start command, Twelve Data REST/streaming, and Android haptics.
- Next validation after deployment: user should fully close Telegram Mini App and reopen it (fresh initData), then verify API status changes from LOCKED to CONNECTING/ONLINE and Start is enabled. If still locked, inspect browser network/request logs and improve sanitized auth/CORS diagnostics without logging initData, user IDs, cookies, or tokens.


## 2026-11-02 — Main Market Mini App v4 rebuild (HTTP-first client)

- User reported the app authenticated but pressing Start did not load market data and requested a complete Mini App rebuild.
- Replaced the Main Market frontend on branch `main-market` only:
  - `main-market/public/index.html`: rebuilt compact dashboard, pair selector, feed diagnostics, signal panel, indicator cards, timers and device controls.
  - `main-market/public/styles.css`: replaced visual system with a responsive mobile-first layout.
  - `main-market/public/app.js`: removed the WebSocket-first client lifecycle and replaced it with authenticated HTTP control + 2-second state polling + 4-second lease heartbeat. This makes start failures and API errors visible in the UI and avoids the prior WebSocket/polling handoff complexity.
  - Retained Telegram initData authentication, server-side session cookie, manual pair selection, Start/Stop, sound/vibration toggles, device tests, signal alerts, and 10s/3s pre-alert logic.
  - Added explicit REST / STREAM / candle-count diagnostics and MACD histogram display.
- Frontend commits:
  - `0dd87e1b5b47b519700a8c21abc230023b15886e` — rebuilt index.
  - `01558f0801e1371f22a27012ea7a2098e1bfcb37` — rebuilt styling.
  - `ed89e43919d5a1d34fc9ece11e596162e1b68935` — replaced client runtime with HTTP polling.
- Backend was intentionally not weakened or rewritten in this pass. Existing Twelve Data REST requires 60 closed M1 candles; directional signals still require a fresh Streaming tick. If REST fails, the UI should now show the actual returned error; if REST works but Streaming is not entitled, it should show REST_ONLY and remain STANDBY.
- Current validation status at handoff update: GitHub files re-fetched from `main-market` and confirmed present with new content. Render auto-deploy, install-time tests / syntax checks, runtime REST fetch, and Android Telegram device test are pending. Do not tell the user the new Mini App is live or that market data is working until Render deploy is live and logs show `start requested` followed by `REST ready` (or a specific `REST error`).
- Keep the Android/OCR branch and the `main` frontend untouched.


### v4 validation correction
- First v4 deploy attempts failed during `npm test`, not due to server runtime: two legacy frontend assertions still expected the retired modal/WebSocket-era UI and a literal pre-alert expression.
- Updated the mobile UI regression test to assert the new v4 structure and HTTP polling flow; retained the pre-alert direction guard in the client.
- Additional safety fix: audio-unlock failure is no longer allowed to block the Start command; Telegram vibration now invokes both impact and notification haptics when supported.
- Commits: `23a096867d3842d0260552a7d6e826f06082f7dc` (client hardening), `012ea07d0da84b9f2459c35bd7382701aabc3564` (test contract update).
- Re-run Render build and verify all tests pass before user retest.


### v4 test contract follow-up
- Render exposed two remaining stale test expectations: the new feed section needed a stable `id="feed"`, and the pre-alert test expected the old inline expression instead of the new helper.
- Added the feed ID and updated the regression assertion to validate the helper-based CALL/PUT pre-alert gate.
- Commits: `6fb5de4073332e56c7b7a0efa8fa92711fe47248` (feed target), `b088a249c6d9f9467c5dc2da2a26cf1eadca0b8f` (test assertions).
- Next gate: Render must show all 19 tests passing and node --check succeeding; then deploy must reach live before Android retest.


- Final v4 alert-test compatibility fix: retained explicit `remaining <= 10 && remaining > 3` and `remaining <= 3 && remaining > 0` conditions in the rewritten countdown handler. Commit `4f1e557be7d997ad1938c7a84e435b40e1d79296`.


## 2026-11-02 — Fix Mini App cross-origin session / disabled controls
- Root cause identified: Telegram Mini App frontend is hosted on a separate Render Static Site origin from the Node API. Auth created a session cookie with `SameSite=Lax`; cross-site fetches can omit that cookie, causing the immediate `/api/state` call to fail and the client init catch to disable the Start button.
- Backend now accepts a short-lived session token via `Authorization: Bearer` (still validates against the in-memory session created only after Telegram initData HMAC verification). Auth returns the session token to the in-memory client; it is not written to localStorage. CORS explicitly allows Authorization. Cookie fallback changed to `SameSite=None; Secure`.
- Apply the same HTTP client fix to both `main-market/public/app.js` and root `app.js` because BotFather opens the root static frontend on `main`.
- Preserve Telegram initData validation, session expiry, rate limiting, and all signal logic. No API secret or bot token is exposed to the browser.
- Verification required after deploy: open the Mini App, confirm Start becomes enabled, check `/api/state` succeeds, tap Start, then confirm Render logs show `[radar] start requested`. Not device-verified until user confirms.


### Delivery update — API history warm start and selectable Forex pairs (2026-11-02)

- Frontend commit on `main`: `ced6fcd9546f199a9d5a2dab4e7b4d40a0917fe7`. Root `index.html` remains a single-file HTML/CSS/JS Mini App.
- Added manual Forex selector: EUR/USD, GBP/USD, AUD/USD, EUR/GBP, GBP/JPY, EUR/JPY. EUR/USD remains the default.
- Mini App selection is sent to the backend; it renders the selected market's own status, indicators, explanation, countdown and signal. The selector is disabled while scanning.
- UI explicitly explains that historical M1 candles are fetched from Twelve Data on Start; user does not need to wait for the app to accumulate 60 candles.
- Backend commit on `main-market`: `67d5fc9648d77e44fad190168cd297183519261c`. Backend allowlist now includes the same six Forex pairs; unsupported provider symbols/plan entitlements fail closed and display unsupported/data error rather than issuing signals.
- The backend already performs a forced REST history fetch on Start (`syncSelected({ force: true })`) using outputsize 80 and then starts Twelve Data Streaming. 60 closed candles remain the minimum analysis warm-up because the current analyzer uses EMA50, MACD signal line and ATR. This is fetched from API, not accumulated live. Five candles cannot provide the requested full indicator set.
- Build/test evidence for backend deploy `dep-dbk4jojm8hqs738dudlg`: Render logs show 19 tests passed, 0 failed, and Build successful. At time of writing deploy was transitioning from build to live; verify final deploy status separately.
- Frontend deploy `dep-dbk4jqrncjis73e7l870` reached `live` for commit `ced6fcd9546f199a9d5a2dab4e7b4d40a0917fe7`.
- Pair availability is not guaranteed merely because a pair appears in the selector: Twelve Data API key plan, market coverage, and quota determine support. Each selected pair is tested by REST fetch; failures display an explicit unsupported/error state. Do not claim all six are live-tested until each has returned valid candles and streaming data.
- No broker order execution was added. The Mini App continues to display manual CALL/PUT/STANDBY only.
- Remaining validation: check final backend deploy LIVE, verify /health reports six symbols, test each pair with the actual configured Twelve Data key, confirm REST history + live stream for each, and test selector/countdown/notifications inside Telegram on Android.


## 2026-11-05 — Directional threshold 53 update

- User requested lowering directional trigger threshold to 53 and reducing unnecessary STANDBY decisions.
- Audited the active `main-market` branch: its current analyzer did not contain a Future Simulation module or a separate Adverse Risk Score. It is a transparent rule-based EMA/RSI/MACD/momentum analyzer; do not describe this change as a calibrated forecast probability or completed future-price simulation.
- Added `DIRECTIONAL_THRESHOLD=53` in `main-market/src/config.js`.
- Analyzer now calculates transparent bullish/bearish evidence scores (0–100) from EMA alignment, price vs EMA9, 3/5-bar momentum, last-three-bar direction, MACD histogram and RSI zone. CALL/PUT is considered when the respective score reaches 53 and exceeds the opposing score.
- Removed soft regime/volatility/support-resistance/body-size vetoes from the final directional decision so strong directional evidence is not automatically blocked by HIGH_VOLATILITY, RANGING, REVERSAL or proximity to support/resistance. These metrics remain visible as context.
- Hard data-integrity protections remain: 60 closed M1 candles, valid/ordered OHLC, recent consecutive bars, fresh candle data and fresh live tick (or explicitly allowed fresh REST fallback). Stale/missing/API-failed data remains STANDBY.
- Added regression tests for bullish and bearish threshold decisions.
- This is an evidence score threshold, not a 53% measured win rate. Backtesting, paper-trading and out-of-sample validation are still required.
- Android APK build is not available from this Main Market branch: this branch contains the Telegram Mini App/Node service and no Android Gradle project or APK build configuration. Do not claim an APK was built.


## 2026-11-05 — Historical Analogue Simulation replaces the indicator decision engine

- Supersedes the prior 53-point EMA/RSI/MACD/momentum evidence-score implementation. The active decision path is now Historical Analogue Simulation only.
- Added `main-market/src/historical-analogue.js`: match the latest 8 closed M1 candles against earlier non-overlapping historical 8-candle patterns, rank matches by normalized shape distance, and simulate the next M1 candle using the immediately following candle after each analogue.
- Initial implementation defaults: nearest 20 matches, minimum 12 valid analogues, 53% directional-share threshold, 1-candle M1 horizon. These are transparent initial parameters, not a claim of measured predictive accuracy.
- CALL if upward analogue outcomes are at least 53%; PUT if downward analogue outcomes are at least 53%; otherwise STANDBY. The percentage is an analogue directional share, not a calibrated probability or verified win rate. Out-of-sample backtesting and paper trading remain necessary.
- `src/analyzer.js` now delegates directly to the simulation module. No EMA, RSI, MACD, momentum score or regime score drives decisions.
- Retained only data-quality/source checks: minimum 60 closed candles, valid positive OHLC, increasing timestamps, contiguous latest 8 M1 bars, latest-candle freshness, and a fresh Streaming tick or explicitly enabled fresh REST fallback.
- Removed EMA21/trend-regime signal invalidation in `server.js`. A live signal is held stable for 40 seconds and is cleared only when the price source fails the data freshness gate.
- Regression suite replaced old indicator expectations with analogue-engine, threshold semantics, malformed/stale data, legacy-code absence and HTTP smoke tests.
- Deployment is not considered complete until Render reports the new commit as Live/succeeded and build logs show passing tests. Xiaomi 11T/Telegram behavior still requires physical device confirmation.


## 2026-11-06 — Original AI restored as sole decision engine; Historical Analogue is advisory only

### Branch and recovery record
- Production baseline before this work: branch `main-market`, commit `8ed6d97d587bc3245a8fb5ef5e234b1096508446` (the latest Render Live commit observed before this change).
- Safety copy created before implementation: `backup/main-market-before-original-ai-20261106`. The existing `main-market` branch was not deleted or overwritten.
- Original AI source recovered from Git history at commit `d260d68368a91f07eb9ab65f2e305bb02f08a143`, branch `backup/symmetric-engine-stable`.
- A separate recovery workspace branch was created: `integration/original-ai-historical-assistant`. The Render-compatible implementation branch is `feature/original-ai-historical-assistant-main-market`, based on the production Main Market branch so the Render build command `cd main-market && npm install` remains valid.

### Exact Original AI source copy
- The recovered, unmodified Original AI modules are copied under `main-market/original-ai/`:
  - `engine/`: `analyze-market.js`, `decision-engine.js`, `strategy-router.js`, `signal-cache.js`.
  - `scanner/`: market context and regime/trend scanner.
  - `indicators/`: EMA, RSI, MACD, ADX, volatility, and support/resistance.
  - `strategies/`: UPTREND, DOWNTREND, SIDEWAY, REVERSAL, and shared trend-continuation evaluator.
  - `tests/`: original modular-engine regression tests.
  - `server-original.js`: archived source server for provenance/reference; it is not the active Render HTTP server.
  - `package.json`: marks this archived module subtree as CommonJS so the original source can be loaded safely from the active ESM Main Market app.
- Provenance: these source trees and the archived server are reused from the Git tree at `d260d68368a91f07eb9ab65f2e305bb02f08a143`; they are not a new rewrite of the Original AI.

### Active runtime wiring
- Active Render HTTP/data/UI entry point remains `main-market/server.js` (Twelve Data REST + Streaming, authenticated Mini App, signal hold and alert lifecycle).
- Active analyzer adapter is `main-market/src/analyzer.js`. It calls the recovered `main-market/original-ai/engine/analyze-market.js` for the final CALL/PUT/STANDBY decision.
- `main-market/src/historical-analogue.js` runs separately and its output is attached as `result.assistant` with role `ADVISORY_ONLY`, historical direction, directional share, match counts, similarity distance, evidence, and agreement/conflict with the Original AI.
- The assistant's CALL/PUT result is never copied into the top-level signal and never overrides the Original AI's decision. Historical directional share is explicitly not a calibrated win probability.
- The only permitted non-Original-AI downgrade is the existing hard data-source quality gate: if neither a fresh Streaming tick nor an explicitly permitted fresh REST fallback is available, top-level signal is forced to STANDBY.
- Historical analogue insufficient-match output is marked source-ready when the freshness/source checks passed; lack of analogue matches must not veto an otherwise valid Original AI decision.

### Data and operating scope
- Main Market only: EUR/USD, M1, Twelve Data. No OTC, OCR, 8xTrade, or broker auto-execution.
- Original scanner needs 200 completed M1 candles for EMA200/regime context. Config is therefore set to `MIN_CLOSED_CANDLES=200`, `HISTORY_CANDLES=200`, and `MAX_CANDLES=220` to retain room for the in-progress live candle.
- REST refresh cadence remains 180 seconds; increasing outputsize changes historical depth, not the polling cadence. Verify actual Twelve Data plan entitlement/quota before assuming the 200-bar request is available.
- Historical analogue uses the latest 8 closed M1 candles, up to 20 nearest historical patterns, at least 12 usable matches, and a one-candle historical outcome. Its share is advisory context only.

### Quality gates and delivery status
- Regression tests were rewritten to assert that the Original AI remains the only directional decision-maker, source failures fail closed, and the simulator is advisory only.
- This change is not considered delivered until the new branch passes `npm test` and syntax checks, then Render reports the deployment Live. The existing production service remains on `main-market` until those gates pass.
- No Xiaomi 11T physical-device test is implied by a successful server build. Validate API status, Mini App display, alert timing, sound, vibration, and 40-second signal hold on the handset after deployment.
- Any future change that lets historical analogue scores alter the Original AI decision must be separately backtested out-of-sample and documented; do not silently convert the assistant into a second decision engine.


### 2026-11-06 — True parallel execution for the Historical Assistant
- The active adapter now starts `src/historical-analogue-worker.js` in a Node Worker Thread, then evaluates the Original AI on the main thread while the assistant calculates independently.
- A SharedArrayBuffer/Atomics handoff returns the assistant result with a 5-second timeout. The assistant result is cached by closed-candle history signature and source mode, avoiding repeated worker creation for unchanged M1 history.
- Assistant metadata exposes `executionMode` (`PARALLEL_WORKER_THREAD`, `CACHED_WORKER_RESULT`, or a blocked/unavailable state) and measured worker time.
- Worker failure or insufficient analogue matches does not veto or replace the Original AI decision. Only the hard market-data freshness gate may force the top-level signal to STANDBY.
- The worker is computation-only: no network, API calls, broker actions, timers, or external side effects.
