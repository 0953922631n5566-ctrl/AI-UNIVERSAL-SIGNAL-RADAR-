# OCR Android build handoff — 2026-11-03

## Current state
The user does not have an APK and asked us to produce one. Android source is in this repository under android/. The existing MediaProjection capture shell previously had no frame listener or OCR upload.

## Changes committed on main
- bf65c26: added ML Kit on-device text recognition, ImageReader frame callback, right-side chart crop, price parsing, and HTTPS JSON upload.
- 81532d3: added token entry and status display. The token is saved in app-private preferences and is not embedded in source.
- 9323a40: configured the production Render HTTPS endpoint, ML Kit dependency, and app version 1.0.0 / versionCode 2.
- Upload endpoint: https://ai-universal-signal-radar-main.onrender.com/api/upload-screen
- Package: com.aiuniversal.signalradar
- Current OCR crop: rightmost 20% of screen, vertical 12%-90%; candidate price format has 4-6 decimals and numeric range 0.5-2.0.
- Upload cadence: approximately one frame per second.
- Render health returned status ok and ANDROID_OCR_ONLY; no APK readings have arrived yet.

## Build status
- Latest GitHub Actions run #13: 41664323633, job 126015466901, commit 9323a40.
- Last observed: Android SDK setup completed; Gradle assembleDebug was still running.
- Earlier runs #11 and #12 came from intermediate commits. Use only #13 if successful.
- Do not say APK is ready until run #13 succeeds and artifact download is verified.

## Next actions
1. Poll job 126015466901.
2. If build fails, inspect logs, fix source, and rebuild.
3. Verify APK artifact and SHA-256.
4. User installs on Xiaomi 11T / Android 14, saves token once in the app, then grants screen-capture permission.
5. Verify real price upload from 8xTrade EUR/USD; check /health readingsLoaded and Mini App.
6. If the broad crop reads chart-axis labels, add orange-badge localization and validate against the moving price tag.

## Limitations
- No physical Xiaomi device test yet.
- The server's direction is a simple 5-reading momentum heuristic, not EMA/RSI/MACD or a validated strategy.
- No synthetic prices, external market APIs, or automatic broker orders.
- Never embed reusable credentials in the APK or public source.
