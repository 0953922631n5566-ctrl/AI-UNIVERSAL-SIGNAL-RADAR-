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

## Required GitHub Actions repository secrets
Set these in GitHub repository Settings → Secrets and variables → Actions:
- `BACKEND_URL`: the Render HTTPS base URL.
- `OCR_API_TOKEN`: the current rotated token.

Do not put token values in source files, commits, chat messages, or build logs. A token exposed in chat should be rotated in both GitHub and Render before a production APK is built.

## Not yet verified
- GitHub Actions build has not yet been dispatched or completed.
- No APK artifact has yet been produced or downloaded in this change.
- Live screen OCR from the Xiaomi 11T has not been revalidated after this change.
- CALL/PUT accuracy has not been validated against a representative live price feed.

## Next steps
1. Rotate the token previously exposed in chat; update GitHub Actions secret and Render environment variable with the same new value.
2. Confirm the GitHub browser session is signed in to this repository.
3. Run the `Build Android APK` workflow on `feature/server-price-extraction`.
4. Verify the run is successful and the artifact contains the APK.
5. Install on Xiaomi 11T and verify health, authenticated rawText upload, M1 warm-up, and STANDBY on missing/stale data before enabling any signal alerts.
