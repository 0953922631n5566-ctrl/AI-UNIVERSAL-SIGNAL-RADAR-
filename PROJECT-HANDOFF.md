# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-03

## Main Market single-signal production correction

- Production UI is one screen and one signal lamp only: CALL / PUT / STANDBY.
- REST and WebSocket analysis remain internal confirmation inputs; no second live-signal panel is shown.
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

## Main Market live-price display correction — 2026-11-03

- Production UI now displays the latest WebSocket EUR/USD quote as the main **LIVE PRICE**.
- It displays the quote timestamp and calculated age beside the price. Missing, invalid, unsubscribed, or older-than-75-second quotes display **LIVE PRICE · STALE** and a dash; the UI does not silently fall back to the REST close.
- REST `/api/signal` price remains separately labelled **LAST CLOSED M1** and continues to be used for closed-candle analysis.
- Final CALL/PUT confirmation checks the timestamp-derived live quote age on each client tick; once older than 75 seconds, it cannot confirm a directional alert.
- Signal formulas, two-candle forecast rules, 10-second preparation alert, final 5-second result, 35-second hold, and manual-only/no-auto-trade behavior were not intentionally changed.
- This corrects stale/mislabelled price display and stale quote confirmation; it does not guarantee broker-feed equality or higher signal accuracy.

## Main Market source and alert behavior

- `server.js`: Twelve Data EUR/USD M1 REST feed; excludes a still-forming candle, keeps up to 220 closed candles, requires at least 20, calculates EMA(5/20) and Wilder-smoothed RSI(14), checks freshness, and caches REST results for 120 seconds. API errors/quota exhaustion return STANDBY.
- `live-engine.js`: separate EUR/USD WebSocket subscription; requires authorization, a fresh tick (<=75 seconds), at least 20 closed candles, and two ticks with a usable 30–180 second gap before calculating momentum. Missing/stale stream or insufficient history returns STANDBY.
- `public/index.html`: combines REST closed-candle direction and live WebSocket estimate internally; the Mini App has exactly one visible signal lamp and no separate live prediction panel. CALL/PUT is issued only when both engines agree. The final alert timestamp starts one authoritative 35-second hold; both the signal text and illuminated radar remain active across candle rollover, then reset to STANDBY.
- The signal logic is rule-based, not a trained AI/ML or chart-vision model. WebSocket cadence is approximately one update per minute; the final 5-second alert is not a new tick-level price confirmation.
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
