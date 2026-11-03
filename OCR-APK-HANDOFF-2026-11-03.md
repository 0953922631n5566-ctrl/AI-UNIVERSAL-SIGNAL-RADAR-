# OCR Android build handoff — 2026-11-03

## Current state
The user did not have an APK. We extended the existing Android MediaProjection capture project in this repository and built a new debug APK.

## Changes committed on main
- bf65c26: added ML Kit on-device text recognition, ImageReader frame callback, right-side chart crop, price parsing, and HTTPS JSON upload.
- 81532d3: added token entry and status display. Token is saved in app-private preferences and is not embedded in source.
- 9323a40: configured production Render HTTPS endpoint, ML Kit dependency, and app version 1.0.0 / versionCode 2.
- Upload endpoint: https://ai-universal-signal-radar-main.onrender.com/api/upload-screen
- Package: com.aiuniversal.signalradar
- OCR crop: rightmost 20% of screen, vertical 12%-90%; candidate format has 4-6 decimals and numeric range 0.5-2.0.
- Upload cadence: approximately one OCR frame per second.

## APK build verified
- GitHub Actions run #13: 41664323633, job 126015466901.
- Source commit: 9323a402103de62a8c26cde01ed404bdb2c93a5b.
- Build, APK existence check, SHA-256 generation, and artifact upload steps all completed successfully.
- Artifact ID: 13243902522; name: ai-universal-signal-radar-debug-apk.
- Downloaded ZIP: ai-universal-signal-radar-debug-apk.zip.
- APK extracted and verified as Android package; size 46,404,778 bytes.
- APK SHA-256: 0176f9bd7e919a43c4b4dce12ed805bb0bc7eb4256f4e90423e7d906c6876f2b.
- Artifact expires 2026-11-17.

## Installation and first-use steps
1. Install the APK on Xiaomi 11T / Android 14.
2. Open AI Signal Radar OCR.
3. Paste the OCR token supplied in the chat and tap save. It is stored in app-private preferences, not compiled into the APK.
4. Open the 8xTrade EUR/USD chart.
5. Tap START and approve Android screen capture.
6. Keep the app capture service active while the chart is visible.
7. Verify that the app status shows a price upload and that Render /health readingsLoaded increases.

## Limitations / not yet verified
- No physical Xiaomi 11T test has been performed.
- The broad crop may read chart-axis labels as well as the moving orange badge. Verify with the live chart; add orange-badge localization if needed.
- Render health last returned status ok and ANDROID_OCR_ONLY, but OCR was not yet connected and readingsLoaded was 0.
- Server CALL/PUT uses a simple 5-reading momentum heuristic, not EMA/RSI/MACD or a validated strategy.
- No synthetic prices, external market APIs, or automatic broker orders.
- Never embed reusable credentials in the APK or public source.
