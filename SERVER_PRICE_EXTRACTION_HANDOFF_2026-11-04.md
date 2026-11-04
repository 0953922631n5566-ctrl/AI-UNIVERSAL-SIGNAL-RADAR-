# AI SIGNAL RADAR OCR CLEAN — Server Price Extraction Handoff
Date: 2026-11-04
Branch: feature/server-price-extraction

## Scope
This handoff records the server/APK integration review and changes made on this branch only. The main branch and the legacy real-market system were not modified.

## Existing server implementation verified
- `server.js` already accepts Android OCR `rawText` at `POST /api/ocr/price`.
- Price parsing is performed on the server; APK sends full-screen OCR text rather than extracting a price locally.
- Server requires `OCR_API_TOKEN` from the Render environment and supports Bearer authorization as well as the legacy X-API-Token header.
- No Twelve Data or other external market-price API is used by this server path.
- M1 candles are aggregated from timestamped OCR price observations. A missing M1 interval resets the candle history and returns STANDBY.
- The server requires 6 closed candles before signal analysis.
- Indicator configuration is EMA(3,5), RSI(5), MACD(3,5,2).
- Invalid, ambiguous, stale, duplicated, or stuck price data returns STANDBY/rejection rather than inventing prices.
- Signal endpoint: `GET /api/signal`; health endpoint: `GET /health`.

## APK integration fix
File: `android/app/src/main/java/com/aiuniversal/signalradar/CaptureService.kt`
- APK continues to OCR the full visible screen and uploads `rawText`, symbol, market, and timestamp.
- Removed runtime lookup of an unset local preference `radar_config/ocr_token`.
- APK now reads `BuildConfig.OCR_API_TOKEN`, injected during Gradle build from the GitHub Actions secret.
- Upload authentication now uses `Authorization: Bearer <token>`, matching the requested API contract and server support.
- Backend URL remains `BuildConfig.BACKEND_URL`.

## Build workflow hardening
File: `.github/workflows/build-android-apk.yml`
- Removed dummy/test fallback credentials.
- Build now fails fast if either repository secret is missing.
- Build now rejects non-HTTPS BACKEND_URL values.
- Artifact name remains `ai-signal-radar-debug-apk`; expected APK path is `android/app/build/outputs/apk/debug/app-debug.apk`; retention is 14 days.


## Follow-up implementation — runtime token / no GitHub Secrets
The APK build path was revised on 2026-11-04 so a build no longer depends on GitHub Actions repository secrets:
- android/app/build.gradle.kts now sets BACKEND_URL to the Render URL and does not define an OCR_API_TOKEN BuildConfig field.
- MainActivity.kt now presents a password-style OCR token field, saves the value in app-private SharedPreferences, and passes it to the foreground capture service when starting.
- CaptureService.kt reads EXTRA_TOKEN at runtime and sends it as Authorization: Bearer. The token is not embedded in the APK, Gradle files, workflow, or repository.
- .github/workflows/build-android-apk.yml now builds without BACKEND_URL / OCR_API_TOKEN secrets, installs Android SDK 35, verifies the APK, writes SHA-256, and uploads ai-signal-radar-ocr-clean-apk.
- APK version: 1.3.0 / versionCode 5.
- Commits: 86a25fe (Gradle URL), 5cfdad5 (runtime token service), 9a7cdd9 (token entry UI), 0d3fd49 (workflow).
- GitHub Actions run #8 (ID 41756883972) was triggered automatically by the workflow update on feature/server-price-extraction. At the last check it was still in progress at Set up Gradle; no successful artifact has yet been confirmed.
- Intermediate runs #5–#7 failed because they started from earlier commits whose workflow still required the missing secrets. They are superseded by run #8 and are not the target artifact.

## User installation step after successful build
On first app launch, paste the current OCR token into the token field once, then press START and approve Android screen capture. The app stores it locally for subsequent starts. Do not use the token value that was exposed in chat; rotate it in Render first and use the replacement token in the app.

## Security and remaining verification
- The earlier workflow design embedded a GitHub Actions secret in BuildConfig. This has been removed; runtime token entry is now used instead.
- Rotate any token previously exposed in chat. Never commit it or paste it into repository files.
- Live screen OCR on Xiaomi 11T, authenticated upload, M1 candle warm-up, and signal behavior still require device-side validation.
