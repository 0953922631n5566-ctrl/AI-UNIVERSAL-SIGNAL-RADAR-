# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-03

## Current project tracks

1. **Main Market web app:** the current `main` branch and current Render services contain the EUR/USD M1 Node/Express Mini App.
2. **Standalone Android APK:** explicitly requested for continued delivery tracking, but the Android project is not present in the current `main` tree. The last Android source/build exists in Git history at commit `b26c73001bd9964b6fdc900160d399b819baa2bb`. Re-integrate it additively under `android/` without deleting or replacing the working root web app.

Do not describe the current Main Market web app as the Android app. Do not claim chart-vision AI is active. Do not fabricate CALL/PUT. The historical frame backend deliberately returns STANDBY until a real perception and decision adapter is configured and evaluated. No broker orders are permitted.

## Current main branch snapshot — 2026-11-03

- Branch: `main`
- HEAD: `2d55d6ec78f33bb04b69c669328d95f539470d70`
- Latest commit: `Hold every final alert for 35 seconds then reset`
- Current tree contains `PROJECT-HANDOFF.md`, `README.md`, `live-engine.js`, `package.json`, `public/index.html`, and `server.js`.
- Current tree does **not** contain `android/`, `backend/`, or `.github/workflows/android-apk.yml`.
- The prior Android commit `b26c73001bd9964b6fdc900160d399b819baa2bb` is the merge base of current main; current main is 90 commits ahead of that baseline. Android sources remain retrievable from history but are not build inputs on current main.

## Main Market implementation

- `package.json`: Express 4, node-fetch 2, ws 8, Node 18.x, `npm start`.
- `server.js`: Twelve Data EUR/USD M1 REST feed. It excludes a still-forming candle, keeps up to 220 closed candles, requires at least 20, calculates EMA(5/20) and Wilder-smoothed RSI(14), checks data freshness, and caches REST results for 120 seconds. API errors and quota exhaustion return STANDBY.
- `live-engine.js`: separate EUR/USD WebSocket subscription. It requires an authorized subscription, a fresh tick (<=75 seconds), at least 20 closed candles, and two ticks with a usable 30–180 second gap before calculating momentum. Missing/stale stream or insufficient history returns STANDBY.
- `public/index.html`: requires the REST closed-candle direction and live WebSocket estimate to agree before displaying CALL/PUT. It prevents a duplicate alert for the same candle/direction, holds a confirmed signal or final result for 35 seconds, then returns to STANDBY. Current source has a 10-second preparation alert and a final 5-second result alert.
- The live engine is rule-based, not a trained AI/ML or chart-vision model. WebSocket cadence is approximately one update per minute, so the final 5-second alert is not a new tick-level confirmation.
- The current server code does not implement the earlier requested server-side “signal candle, skip one candle” rotation. The UI's same-candle duplicate guard is not equivalent to a verified one-candle cooldown.
- `README.md` was aligned on 2026-11-03 with the source's 35-second display hold and 10-second/final-5-second alerts.

## Latest GitHub Actions

- Current `main` HEAD `2d55d6ec78f33bb04b69c669328d95f539470d70`: no workflow run is associated with this exact SHA; combined commit status has no checks.
- Latest repository run: [Fast Signal A tests #41583581647](https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/41583581647), a draft PR #10 experiment on branch `experiment/fast-signal-a`, not main and not Android. Job passed 5/5 Node tests; no artifacts were produced.
- Latest Root Mini App CI run: #41450092098 on commit `d5f12a107f583f267e7c845f1762f9700b1cd73c`, older than current main.
- Latest Main Market CI run: #41441892631 on branch `main-market`, not the Android project.
- No Android build workflow currently exists on main.

## Android APK — last verified historical build

- Historical source commit: `b26c73001bd9964b6fdc900160d399b819baa2bb`.
- Historical workflow: [Android APK Build #41307402212](https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/41307402212), completed successfully.
- Historical artifact ID: `13083772367`, artifact name `ai-universal-signal-radar-debug-apk`.
- APK SHA-256 verified from actual artifact bytes and rechecked locally on 2026-11-03:
  `c5a2a9a04bdff133097bc6ad5a664eb93b2d652cd32fcb859031534ba2acaeac`.
- APK is a debug build from the historical Android source, not a build of current main. It has not been device-tested or validated end-to-end on Xiaomi 11T.

### Historical Android source audit at `b26c730...`

- `MainActivity.kt`: START/STOP UI, Android screen-capture consent, service lifecycle and status/error broadcasts.
- `CaptureService.kt`: MediaProjection foreground service, VirtualDisplay and ImageReader initialization. It does not attach an image-available listener, encode JPEG frames, upload frames, or parse backend decisions.
- Android UI only reports capture service status; it does not yet render backend STANDBY/CALL/PUT with a decision reason.
- `android/app/build.gradle.kts` contains a placeholder `BACKEND_URL`, not a deployed endpoint.
- Historical `.github/workflows/android-apk.yml` builds a debug APK, but this workflow file is not present on current main.

### Historical backend source audit at `b26c730...`

- `backend/app.py` has Bearer-token authorization using server environment variable `RADAR_INGEST_TOKEN`, session start/stop routes, frame metadata/dimension/size/type/freshness/sequence validation, and in-memory session/frame state.
- The frame route records the frame hash but intentionally returns `STANDBY` with `VISION_ADAPTER_NOT_CONFIGURED`.
- No perception model, decision model, model configuration, evaluation results, or live inference tests exist in that source.
- No FastAPI frame-ingestion service is currently listed in Render. The historical backend source is not deployed.

## Render deployment snapshot — 2026-11-03

- Existing Node service `ai-universal-signal-radar-main`, service ID `srv-dbkaoo0473hc7384tmog`, is on branch `main`, free plan, auto-deploy enabled.
- Latest deploy `dep-dbko3qrbc2fs7383jv9g` is `live` for commit `2d55d6ec78f33bb04b69c669328d95f539470d70`; finished 2026-11-03 06:41:22 UTC.
- Existing Static Site `my-ai-signal-bot-v2` also deployed current main commit. These are Main Market web services, not Android frame-ingestion backend services.
- HTTP endpoint content was not independently verified in this audit. Render's deployment control plane reports the latest Node deploy as live.
- Do not create paid resources or enable paid plans without explicit approval. No new Render resource was created during this audit.

## Android delivery blockers and next steps

1. Re-integrate the historical Android project and Android APK workflow into current `main` as additive files; preserve all root Main Market files.
2. Implement ImageReader frame callback, safe RGBA-to-Bitmap conversion, JPEG encoding, frame throttling/backpressure, and cleanup.
3. Design secure device pairing/token issuance. Never embed `RADAR_INGEST_TOKEN`, API keys, or any reusable secret in APK or public source. A user/device pairing step may be required before authenticated upload can work.
4. Implement authenticated HTTPS multipart upload, response parsing, UI display of STANDBY/CALL/PUT plus reason, retry/backoff, session expiry and network error handling.
5. Re-integrate and deploy the FastAPI backend only on an approved, non-paid configuration; test auth, validation, session lifecycle, replay protection and frame ingestion.
6. Keep every decision STANDBY until a real vision/perception adapter and decision model are configured, evaluated on representative chart data, and pass documented safety tests.
7. Build APK from the current main commit, inspect CI logs/artifact bytes and SHA-256, then test capture and upload on a real Xiaomi 11T. Do not mark device-tested or validated without evidence.

## Verification status

| Area | Status |
|---|---|
| Current Main Market source | Implemented; latest root deploy reported live |
| Historical Android MediaProjection startup | Implemented in old commit only |
| Android JPEG frame pipeline | Not implemented |
| Authenticated HTTPS upload from Android | Not implemented |
| Android backend response parsing / signal UI | Not implemented |
| Historical backend auth and validation | Implemented in old commit only |
| Historical backend session/frame state | In-memory only; limited |
| Vision/perception/decision model | Not configured |
| APK build | Historical debug APK built and SHA-256 checked |
| APK built from current main | No |
| Backend frame service deployed | No |
| Xiaomi 11T device test | No evidence |
| End-to-end validation | Not validated |

No secrets are stored in GitHub or APK. No automated broker execution is implemented or permitted.
