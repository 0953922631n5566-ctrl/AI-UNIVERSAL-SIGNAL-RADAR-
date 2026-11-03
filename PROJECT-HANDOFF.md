# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-03

## Main Market single-signal production correction

- Production UI is one screen and one signal lamp only: CALL / PUT / STANDBY.
- REST supplies completed candle history and freshness only; WebSocket live price plus the single NEXT M1 forecast supplies the only directional decision.
- Final notification starts the single 35-second hold timer. The illuminated radar state is not cleared at the next candle boundary; it resets to gray STANDBY only when the 35 seconds elapse.
- Final decision display is the only directional output. Before the final notification, the lamp stays STANDBY even if both engines have pre-confirmed a direction.
- No parallel test system or second production service is introduced.

## Project tracks and preservation rules

1. **Main Market web app:** EUR/USD M1 Node/Express Mini App remains deployed and must not be removed or replaced while Android work continues.
2. **Standalone Android APK:** requested delivery track. The Android project and FastAPI frame-ingestion baseline have been restored additively under `android/` and `backend/` on `main`.
3. **Alert requirements:** `ALERT_CONFIGURATION.md` is the source of truth. Read it before touching alerts. Preserve the exact 10-second preparation alert, final 5-second CALL/PUT/STANDBY result, sound/vibration for STANDBY, and 35-second hold/reset cycle unless the user explicitly changes it.

Do not describe the Android capture shell as an AI chart analyzer. Do not fabricate CALL/PUT. The backend must remain STANDBY until a real perception and decision model is configured and evaluated. No broker orders are permitted.

## Current main branch / Android reintegration

- Android reintegration commit: `ceef0bfb634c29e66b70456e56e4b673c6bd71f4`
- Commit message: `build: restore Android APK and frame-ingest baseline additively`
- Added files from the historical Android baseline:
  - `.github/workflows/android-apk.yml`
  - `android/app/build.gradle.kts`
  - `android/app/src/main/AndroidManifest.xml`
  - `android/app/src/main/java/com/aiuniversal/signalradar/MainActivity.kt`
  - `android/app/src/main/java/com/aiuniversal/signalradar/CaptureService.kt`
  - `android/build.gradle.kts`
  - `android/gradle.properties`
  - `android/settings.gradle.kts`
  - `backend/app.py`
  - `backend/requirements.txt`
- This was additive. Existing root Main Market files and `ALERT_CONFIGURATION.md` were preserved.
- The Android build workflow triggers on changes under `android/**` or to its own workflow file on branch `main`.

## Android APK — latest verified build

- Workflow: [Android APK Build #41592461418](https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/41592461418)
- Run status: completed / success.
- Build source commit: `ceef0bfb634c29e66b70456e56e4b673c6bd71f4`.
- Job ID: `125772074700`.
- Steps passed: JDK 17 setup, Gradle setup, Android SDK platform install, `:app:assembleDebug`, APK existence check, SHA-256 generation, artifact upload.
- Gradle log confirms `BUILD SUCCESSFUL in 27s`; no compile errors.
- Artifact ID: `13210975903`; name: `ai-universal-signal-radar-debug-apk`; ZIP size: 815,373 bytes; expires 2026-11-17 06:51:48 UTC.
- Artifact ZIP digest: `sha256:2651ebfd13d3e8b4ab2ba2d9a1981557a72899b4111f960754ae2797c7bec761`.
- APK size: 822,161 bytes.
- APK SHA-256 calculated from the downloaded artifact bytes and checked against the artifact's `SHA256SUMS.txt`:
  `f4cb8a7a6c1865791f9b469277ab781ae9791c6f7064acca73acdd8b9d8784a1`.
- This is a debug APK. It is built and artifact-verified, but not device-tested or end-to-end validated on Xiaomi 11T.

## Android source implementation audit

| Requirement | Current status |
|---|---|
| MediaProjection permission and foreground service | Implemented |
| START/STOP service lifecycle and status/error broadcasts | Implemented baseline |
| ImageReader creation | Implemented |
| ImageReader frame listener / frame throttling | Not implemented |
| RGBA-to-Bitmap conversion | Not implemented |
| JPEG encoding | Not implemented |
| Authenticated HTTPS frame upload | Not implemented |
| Secure token provisioning without embedding secrets | Not implemented |
| Backend response parsing | Not implemented |
| UI showing STANDBY/CALL/PUT plus reason | Not implemented |
| Retry/backoff and network recovery | Not implemented |
| Xiaomi 11T device test | No evidence |

The current `CaptureService.kt` creates the MediaProjection, VirtualDisplay and ImageReader, but never attaches an image-available listener. The current `MainActivity.kt` displays capture-service state only. `android/app/build.gradle.kts` still has a placeholder `BACKEND_URL`; it is not a live endpoint.

## Backend source audit

- `backend/app.py` uses Bearer-token authorization from server-only environment variable `RADAR_INGEST_TOKEN`.
- It provides `/health`, `/v1/session/start`, `/v1/session/stop`, and `/v1/frame`.
- It validates session ID, sequence, dimensions, image size/type, timestamp freshness, and duplicate/out-of-order frames. It records frame hashes and basic in-memory session/frame state.
- Session state is process-memory only; a frame can implicitly create a state through the default dictionary, and no expiry/cleanup policy is implemented yet.
- It deliberately returns `STANDBY` with `VISION_ADAPTER_NOT_CONFIGURED`. There is no perception model, decision model, model configuration, evaluation set, or inference test.
- The FastAPI service is not deployed in Render. Existing Render services are Node/Static Site services for the Main Market web app, not this frame-ingestion API.

## Main Market single-horizon forecast simplification — 2026-11-03

- User explicitly requested removal of the additional analysis layers and retention of only one next-candle M1 forecast.
- `forecast-engine.js` now exports `evaluateNextCandle` only; FOLLOWING M1 was removed.
- `live-engine.js` exposes one `forecast` object and uses it as the sole directional forecast.
- `server.js` now uses REST only for closed-candle history and freshness checks. The former REST EMA5/EMA20/RSI direction output was removed.
- `public/index.html` displays only NEXT M1 and the final alert uses that forecast directly. The former requirement that REST CALL/PUT and WebSocket CALL/PUT agree was removed.
- Existing NEXT M1 six checks and 5-of-6 threshold were retained; freshness requirements remain (REST candle age <=180s, live quote <=75s, WebSocket subscribed, >=35 closed candles, momentum from two ticks 30–180s apart).
- Alert schedule and behavior remain: preparation at 10s, final result at 5s, CALL/PUT/STANDBY all held 35s, manual-only/no-auto-trade.
- Do not describe this as guaranteed accuracy. Device-side sound/vibration still needs Xiaomi 11T verification.

## Main Market live-price display correction — 2026-11-03

- Production UI now displays the latest WebSocket EUR/USD quote as the main **LIVE PRICE**.
- It displays the quote timestamp and calculated age beside the price. Missing, invalid, unsubscribed, or older-than-75-second quotes display **LIVE PRICE · STALE** and a dash; the UI does not silently fall back to the REST close.
- REST `/api/signal` price remains separately labelled **LAST CLOSED M1** and continues to be used for closed-candle analysis.
- Final CALL/PUT confirmation checks the timestamp-derived live quote age on each client tick; once older than 75 seconds, it cannot confirm a directional alert.
- Signal formulas, two-candle forecast rules, 10-second preparation alert, final 5-second result, 35-second hold, and manual-only/no-auto-trade behavior were not intentionally changed.
- This corrects stale/mislabelled price display and stale quote confirmation; it does not guarantee broker-feed equality or higher signal accuracy.

## Main Market source and alert behavior

- `server.js`: Twelve Data EUR/USD M1 REST feed; excludes a still-forming candle, keeps up to 220 closed candles, requires at least 35 for the forecast input, checks REST freshness, and caches history for 120 seconds. It no longer calculates a competing REST CALL/PUT direction.
- `live-engine.js`: EUR/USD WebSocket subscription; requires authorization, a fresh tick (<=75 seconds), at least 35 closed candles, and two ticks with a usable 30–180 second gap before calculating momentum. Missing/stale stream or insufficient history returns STANDBY.
- `forecast-engine.js`: only NEXT M1 forecast remains. It uses EMA(5/20), RSI(14), MACD(12/26/9), last closed candle body and live momentum; a direction requires at least 5 of 6 checks.
- `public/index.html`: one forecast and one visible signal lamp. The final alert uses the NEXT M1 forecast directly when REST history and live quote freshness guards pass; no second directional engine must agree. The final alert timestamp starts one authoritative 35-second hold; the signal remains active across candle rollover, then resets to STANDBY.
- The signal logic is rule-based, not a trained AI/ML or chart-vision model. WebSocket cadence is approximately one update per minute; the final 5-second alert is based on the latest available valid forecast, not a new tick-level price confirmation.
- The current server code does not implement the earlier server-side “signal candle, skip one candle” rotation. Same-candle duplicate suppression is not equivalent to a verified one-candle cooldown.
- `ALERT_CONFIGURATION.md` is mandatory for future alert work.

## GitHub Actions and Render

- Latest Android build is #41592461418 (success, details above).
- The latest Fast Signal A test run #41583581647 is a draft PR experiment on `experiment/fast-signal-a`, not production Android code; 5/5 Node tests passed and it produced no APK.
- Existing Node service `ai-universal-signal-radar-main`, service ID `srv-dbkaoo0473hc7384tmog`, is on branch `main`, free plan, auto-deploy enabled.
- After Android reintegration commit `ceef0b...`, Render deploy `dep-dbko8ht9el5s73eor6og` reported `live` for the existing Node service.
- Existing Static Site `my-ai-signal-bot-v2` deploy `dep-dbko8i59el5s73eor6t0` reported `live` for the same commit.
- These deployments serve the root Main Market web app; neither is the FastAPI frame-ingestion backend.
- No new paid resource or paid plan was created. Do not enable paid services without explicit user approval.

## Next steps to reach delivery

1. Implement ImageReader listener, safe RGBA-to-Bitmap conversion, JPEG encoding, frame throttling/backpressure, and robust cleanup.
2. Design secure device pairing/token issuance. Never embed `RADAR_INGEST_TOKEN`, API keys, or reusable secrets in APK or public source. A one-time user/device pairing step may be required.
3. Configure a non-secret backend base URL and implement authenticated HTTPS multipart upload.
4. Parse backend decisions and show STANDBY/CALL/PUT with reason in the Android UI; add retry/backoff, session expiry, and network error recovery.
5. Deploy FastAPI only on an approved non-paid configuration; test authentication, validation, session lifecycle, replay protection and frame ingestion.
6. Keep all decisions STANDBY until a real vision/perception adapter and decision model are configured and evaluated on representative chart data with documented safety tests.
7. Build from current main, inspect CI logs/artifact bytes/SHA-256, then test capture and upload on a real Xiaomi 11T. Do not mark device-tested or validated without evidence.

## Delivery status

| Area | Status |
|---|---|
| Main Market web app | Implemented; existing Render deployments reported live |
| Android source on main | Restored additively |
| Android APK build | Built successfully |
| APK artifact bytes / SHA-256 | Downloaded and verified |
| MediaProjection startup | Implemented baseline; device test pending |
| JPEG pipeline | Not implemented |
| Authenticated HTTPS upload | Not implemented |
| Backend response parsing / signal UI | Not implemented |
| Backend auth / validation source | Implemented baseline |
| Backend deployed | No |
| Vision/perception/decision model | Not configured |
| Xiaomi 11T device test | No evidence |
| End-to-end validation | Not validated |

No secrets are stored in GitHub or APK. No automated broker execution is implemented or permitted.


## Latest production implementation — closed-candle-only M1 (2026-11-03)

- User authorized prioritizing reliable operation over the Twelve Data daily quota.
- server.js now refreshes Twelve Data EUR/USD M1 history immediately after each UTC minute boundary. Expected ceiling: 1,440 REST calls/day. Browser polling is served from the server cache every 5 seconds.
- forecast-engine.js accepts only the closed-candle array. Its function signature has no live price or momentum input. It calculates EMA5/20, MACD(12/26/9), RSI14, and candle body checks; direction requires at least 5/6 votes.
- live-engine.js uses the latest closed candle key to calculate once per new candle. It returns STANDBY if the latest close is older than 90 seconds. The WebSocket quote remains available for live price display only; it is not used in direction.
- Each forecast has validFor NEXT_M1_ONLY, lastClosedAt, and nextCandleAt. A new completed candle causes recomputation; no previous direction is carried forward as a second horizon.
- Alert timing: preparation 10 seconds before boundary; final CALL/PUT/STANDBY published 5 seconds into the new minute (the next candle the signal applies to); hold for 35 seconds from notification. This alignment avoids announcing the decision from candle N as if it applied to candle N+2.
- Production deploy: dep-dbkpqbh9dmos739lgd20, commit 2c11140154816429d7baf773fa80ad0b9ee2b958, status LIVE.
- Live endpoint verification at 2026-11-03 08:37 UTC: /health status=ok, historyCandles=200, refreshIntervalSeconds=60, pollingMode=M1_CANDLE_CLOSE, WebSocket subscribed. /api/signal apiStatus=connected, REST history only, 200 closed candles. /api/live returned a single PUT forecast, 6/6 checks, with validFor NEXT_M1_ONLY; live price is separate.
- CI: Node Forecast Tests run 41604493045 completed successfully.
- Telegram Mini App URL: https://ai-universal-signal-radar-main.onrender.com/
- No automatic trading. This is a rule-based signal tool, not a guarantee of outcomes. Actual Telegram bot menu/launch configuration and device sound/vibration are not verifiable from the Render service alone.


## Candle-aligned early alert and trend correction — 2026-11-03

- Work is isolated on branch `fix/early-m1-alert-candle-trend`; production `main` has not been changed by this work yet.
- `forecast-engine.js` retains EMA5/EMA20, RSI14, MACD12/26/9, the 35-closed-candle minimum, and the 5-of-6 vote threshold. It now also derives an explicit EMA trend regime (UPTREND/DOWNTREND/SIDEWAYS) and latest closed candle body direction (BULLISH/BEARISH/NEUTRAL).
- CALL is permitted only when the EMA trend is UPTREND and the latest closed candle is bullish. PUT is permitted only when the EMA trend is DOWNTREND and the latest closed candle is bearish. A conflicting candle body forces STANDBY; no counter-trend signal is published.
- Mini App trend cards separately show the EMA trend, latest completed candle direction, and RSI14.
- Final alert no longer waits for a hard-coded 5–6 second window. It checks the local live endpoint every 500 ms and emits as soon as the fresh forecast's `nextCandleAt` matches the current M1 boundary. If no matching valid result arrives within 12 seconds, it emits STANDBY once and does not issue a late directional signal for that candle.
- When scanning starts mid-minute, it waits for the next boundary rather than generating a late result for the already-open candle.
- The 10-second preparation reminder, sound/vibration for all final outcomes, 35-second hold, one result per minute, Telegram Mini App UI, live WebSocket price display, and manual-only/no-auto-trade behavior are preserved.
- Important timing limit: Twelve Data REST refresh is still scheduled just after the minute boundary to obtain a fully closed candle. Therefore this improves the previous fixed +5–6-second client delay, but zero-latency notification cannot be guaranteed; provider response and network time remain. If no fresh exact-boundary result is available by +12 seconds, the safe result is STANDBY.
- Added tests assert that CALL/PUT can never contradict the latest closed candle direction and EMA trend. Run `npm test` before merging/deploying.
- Production status: not yet merged or deployed. Do not call this production-ready until CI passes, the PR is reviewed/merged, Render deploy is LIVE, health/API data are verified, and the physical Telegram Mini App sound/vibration test is performed.


## Live quote-derived M1 candle completion — 2026-11-03

- Branch: `fix/live-tick-m1-candle-feed`; PR #13 targets `main`.
- Twelve Data REST can lag the most recent completed M1 candle. The live engine now aggregates fresh WebSocket quotes into minute OHLC bars so the latest completed minute can be evaluated at the next boundary when REST history has not caught up.
- A tick-derived bar is finalized only when a tick from the immediately following minute arrives. Multiple in-minute ticks use the last in-minute quote as close; a minute with only one tick uses the next boundary quote as close.
- Gaps do not create synthetic missing bars. REST OHLC remains authoritative when it has the same timestamp; tick-derived candles fill only absent REST minutes.
- The forecast cache key now includes OHLC values, so a REST replacement of a tick-derived bar causes recalculation.
- Tests cover multi-tick aggregation, single-tick boundary close, missing-minute gaps, and out-of-order ticks. CI status must be checked before merge.
- The existing strict alert alignment remains: only publish when the forecast targets the current M1 boundary and the quote is fresh; otherwise STANDBY. No late direction or automatic orders.


## Production verification — 2026-11-03 (latest)

- PR #12 merged: commit `2b41308e0895e2798e48daef86b8c4f273275579` — early result publication and EMA/candle trend alignment.
- PR #13 merged: commit `bbfbb8d7194a06731ac7f70bbeafb8022984aa31` — live quote M1 candle aggregation and forming-candle data.
- Render service: `ai-universal-signal-radar-main`, service ID `srv-dbkaoo0473hc7384tmog`, production URL `https://ai-universal-signal-radar-main.onrender.com`.
- Latest Render deploy: `dep-dbkqd3p7lnhs73864oqg`; Render event reported deploy ended successfully at 2026-11-03T09:17:41Z.
- GitHub Actions Node Forecast Tests run `41609709293` completed successfully; `npm test` passed. Inline Mini App JavaScript and live-engine syntax were also checked.
- Post-deploy `/health` returned `status=ok`, 200 history candles, and WebSocket status `subscribed`. The `/api/live` sample showed a 6/6 PUT only when both EMA trend and latest closed candle were bearish; the previous conflicting bullish-candle/downtrend sample returned STANDBY.
- The process had just restarted during the last API sample: WebSocket was subscribed but no fresh post-restart tick had arrived yet, so live price and `liveCandle` were temporarily null. Recheck after the next fresh quote; do not mark tick aggregation end-to-end verified until `liveCandle` becomes populated and a completed tick candle is observed.
- The Mini App HTML is served at the existing URL and now has a LIVE M1 CANDLE display. Telegram bot menu/launch configuration was not changed or independently tested in Telegram. Actual phone sound/vibration also remains untested.
- Live tick candle rules: aggregate only fresh quotes; finalize a minute only on the immediately following minute's tick; if a minute had one tick, use the next boundary quote as its close; if there is a gap, do not invent missing bars. REST OHLC remains authoritative when present. This is a quote-derived fallback, not a substitute for the broker's exact OHLC feed.
- Signal operation remains EUR/USD NON-OTC M1, manual-only, no broker order placement. Keep STANDBY whenever fresh aligned data is unavailable.


## Current live candle direction guard — 2026-11-03

- PR #14 adds a final guard before any CALL/PUT is shown or alerted.
- A directional forecast must target the exact currently opening M1 minute and arrive within the first 12 seconds.
- The current forming M1 candle must be from that same minute, have at least 2 fresh WebSocket ticks, and agree with the direction: CALL requires live BULLISH; PUT requires live BEARISH.
- If the current candle is opposite, the quote stream has not provided enough ticks, the forecast is stale, or the candle minute does not match, the live prediction and final alert are STANDBY.
- The Mini App LIVE M1 CANDLE card shows the forming candle direction. The forecast text still separately reports the last closed candle direction.
- GitHub Actions run `41610183584` completed successfully, including `npm test`. Inline Mini App and live-engine JavaScript syntax checks passed.
- Merge and Render deployment pending at time this handoff was written.


## Complete analysis formula replacement — 2026-11-03

- User supplied a complete replacement Node.js Forex formula and explicitly instructed that the old analyzer be removed.
- Branch: `replace-analysis-with-user-formula` (not yet merged at the time of this handoff update).
- `forecast-engine.js` has been replaced: EMA5, EMA20, Bollinger Bands(20,2), RSI14, exact 0–3 second final-M1 trigger window, supplied SAFE/DANGER and confidence calculation. Old MACD, 5-of-6 scoring, old candle-body trend confirmation and previous forecast rules are removed.
- `live-engine.js` now evaluates the formula against real Twelve Data closed M1 candle history and the latest real WebSocket EUR/USD tick. The supplied random-seed and Math.random price generator are deliberately not used.
- CALL only when EMA5 > EMA20 and current live price >= EMA5; PUT only when EMA5 < EMA20 and current live price <= EMA5. Bollinger bandwidth <0.04% blocks direction as SIDEWAY/DANGER.
- Direction is locked for 30 seconds after it is generated. A new direction can be generated only in the final 3 seconds of an M1 minute. Stale/missing live ticks or fewer than 20 closed candles return STANDBY.
- Mini App preparation reminder remains 10 seconds before rollover; final result is issued in the last 3 seconds, with STANDBY fallback at the minute edge; CALL/PUT/STANDBY are held 30 seconds and then reset.
- This explicitly supersedes the previous 5-second final notification and 35-second hold in the earlier alert configuration.
- Automated Node tests were rewritten for the exact supplied formula. CI, Render deployment, live endpoint and Telegram/device behavior must still be checked before calling this production-ready.
- No automated trading.



## Production formula replacement verified — 2026-11-03

- PR #15 merged to `main`; production commit: `c063a8d5bffa4c40afbac8fa6bc080e72f05da96`.
- Render service: `ai-universal-signal-radar-main`, service ID `srv-dbkaoo0473hc7384tmog`.
- Render deploy: `dep-dbkrilgae00c73ft47bg`; status `live`; finished 2026-11-03T10:37:50Z.
- GitHub Actions Node Forecast Tests run `41620717508` completed successfully. Includes the supplied formula tests and Mini App inline-JavaScript syntax validation.
- `forecast-engine.js` now contains only the requested EMA5/EMA20, Bollinger Bands(20,2), and RSI14 calculation. The former MACD, six-vote score, old trend/candle guard and prior NEXT-M1 forecast analyzer are removed.
- `live-engine.js` consumes Twelve Data EUR/USD closed M1 candles plus real live WebSocket quote ticks. No random seed prices or Math.random simulation is used.
- Final CALL/PUT candidate is evaluated only when 0–3 seconds remain in the current M1 candle. CALL requires EMA5 > EMA20 and live price >= EMA5; PUT requires EMA5 < EMA20 and live price <= EMA5. Bollinger bandwidth <0.04% forces SIDEWAY/DANGER and blocks direction. Signal state is held for 30 seconds.
- Mini App: 10-second preparation alert retained; final result is emitted in the last 3 seconds (STANDBY fallback at the minute edge); all final results are held 30 seconds, then reset to STANDBY. Manual-only; no broker order execution.
- Post-deploy `/health`: status=ok, 200 history candles, WebSocket subscribed.
- Post-deploy `/api/signal`: apiStatus=connected, signal=DATA_ONLY, 200 real closed candles.
- Post-deploy `/api/live` after fresh quote: WebSocket subscribed, live EUR/USD quote received, data age 2 seconds; EMA/BB/RSI output present. The observed sample had Bollinger bandwidth 0.03666%, so the correct result was SIDEWAY/DANGER/STANDBY. No CALL/PUT was observed in that sample; this is not a failed deployment.
- Production homepage fetch confirmed the new EMA/Bollinger/RSI formula labels. A real Telegram Mini App tap-through and physical Xiaomi 11T sound/vibration test have not been performed. A live CALL/PUT at the final-three-second boundary has not yet been observed end-to-end; pure logic is covered by passing automated tests.
- Current production URL remains `https://ai-universal-signal-radar-main.onrender.com/`.


## Multi-regime M1 signal and 5s/35s alert update — 2026-11-03

- User requested replacing the prior narrow signal behavior with Trend, Sideway, and Breakout market regimes, a 10-second preparation alert, final entry alert in the last 5 seconds, and a 35-second visible signal hold.
- Implemented on branch `feat/multi-regime-five-second-alert`; production `main` is unchanged until PR merge.
- `forecast-engine.js` now analyses real closed M1 candles plus the current live quote:
  - TREND: EMA5/EMA20 alignment with live price confirmation.
  - BREAKOUT: live price above the previous 20-candle high (CALL) or below the previous 20-candle low (PUT).
  - SIDEWAY: Bollinger bandwidth <0.04%; only a support bounce with RSI <=45 or resistance rejection with RSI >=55 can produce a direction. Otherwise it remains STANDBY.
  - RSI14 and Bollinger Bandwidth are supporting indicators; no synthetic/random prices or unconditional fallback signals.
- `live-engine.js` creates a directional signal only during the final 5 seconds of the current M1 candle. It holds the server-side signal for 35 seconds.
- `public/index.html` retains the existing Telegram Mini App and real-data endpoints, updates the final-signal freshness tolerance for the 5-second window, and changes the display/hold labels to 35 seconds. The 10-second preparation reminder remains.
- `server.js` retains the Twelve Data REST history and WebSocket architecture, adds `/api/config` with the selected regimes and alert timings, and exposes strategy/timing in `/health`. This intentionally does not replace real market data with fixed demo prices or CALL fallbacks.
- The supplied sample server code was not copied literally because it uses axios although axios is not installed, calls REST every 15 seconds, and returns CALL with a fabricated price on missing API key/API errors. That behavior could falsely signal a real trade.
- Tests were updated for the multi-regime analyzer and existing live-candle aggregator API. Run GitHub Actions before merging; Render deployment and live endpoint verification remain pending until PR merge.
- Required acceptance: health endpoint reports 5-second/35-second settings; /api/live shows correct regime and STANDBY on stale data; 10s preparation alert; one final result per M1 minute in the last 5s; CALL/PUT/STANDBY held 35s; no automatic broker orders.
- Telegram bot menu URL and physical Xiaomi 11T sound/vibration have not been changed or verified by this branch.
