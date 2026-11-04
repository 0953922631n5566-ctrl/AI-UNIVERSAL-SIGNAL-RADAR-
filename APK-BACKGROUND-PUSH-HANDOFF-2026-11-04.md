# APK Main Market + Background Push Handoff — 2026-11-04

## User-approved target
- Rebuild the Android APK as a compact Main Market companion for Xiaomi 11T / Android 14.
- Market: real EUR/USD, Non-OTC, M1, Twelve Data through the existing Main Market server. Do not put the Twelve Data API key in the APK.
- Score policy requested by user: restore the prior 64% behavior, not 68%. Do not implement a bare threshold change until the exact previous scoring formula/behavior is recovered and tested.
- APK screen: one logo-style ON/OFF control; display price, buy pressure, sell pressure, trend/regime and current CALL/PUT/STANDBY state. No floating window, OCR, screen capture, or broker order execution.
- Background alerts: CALL/PUT notifications with sound/vibration, one alert per M1 candle, while the app is backgrounded or swiped from Recents. STANDBY is silent.
- Notification tap should open the APK. Android 13+ notification permission must be requested at runtime.

## Repository / branch
- Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
- Work branch created: feat/main-market-apk-background-fcm
- Branch base: main (keeps existing source isolated; do not merge/deploy until tests and user acceptance).
- Existing Android source on main is OCR/MediaProjection and is not compatible with the requested Main Market API.
- Existing Main Market backend lives under main-market/ on branch main-market and is a separate Render service. Its current auth is Telegram Mini App initData, not an Android device API.
- Existing Main Market analyzer is a conservative EMA9/21/50 + RSI14 + MACD + ATR + price-action/regime heuristic and has no percentage confidence score. The old 64% scoring formula was not found in the current default-branch source or the current Main Market analyzer. Do not claim 64% is restored until the exact prior scoring implementation is located or user supplies the prior APK/source.

## Background delivery design
- Use Firebase Cloud Messaging (FCM), not a timer/polling loop or MediaProjection foreground service. FCM is the appropriate design for notifications after the app is swiped away; Android force-stop, disabled notifications, network restrictions, and OEM battery policies can still prevent delivery until the user reopens/permits the app.
- Android client needs Firebase Messaging SDK, notification channel, POST_NOTIFICATIONS runtime permission, Firebase token/topic registration, and an explicit deep link into the app.
- Server needs Firebase Admin / FCM HTTP v1 credentials and a durable device-token registry or equivalent secure registration mechanism. Never commit service-account credentials or API secrets.
- Required external setup not present in this repository: Firebase project configuration for Android (google-services.json or equivalent Firebase app identifiers) and a server-side Firebase service-account credential configured as a Render secret. Until supplied/configured, end-to-end push cannot be built or verified.
- Prefer token registration with authenticated device binding and durable storage. Do not use a publicly guessable broadcast topic as the production authorization model.

## Initial audit findings (2026-11-04)
- main branch server.js is OCR-only, requires OCR_INGEST_TOKEN and returns STANDBY; it is not the Main Market backend.
- main branch MainActivity.kt currently asks for an OCR token and MediaProjection permission; CaptureService.kt scans screen pixels and uploads OCR prices. These must be removed from the new APK branch, not reused.
- main branch Android manifest currently lacks POST_NOTIFICATIONS and Firebase Messaging service declarations.
- main-market branch backend currently exposes Telegram-authenticated endpoints and runs the real EUR/USD analysis. It has no Android device authentication / FCM push pipeline.
- main-market/src/analyzer.js does not contain a 64% score; root forecast-engine.js has a separate 63 strictness setting and is not the deployed Main Market analyzer. Avoid mixing these implementations.
- No source code or deployment was changed in this audit. Only this isolated work branch was created.

## Acceptance gates
1. Recover/confirm the exact 64% legacy scoring behavior and add unit tests, including CALL/PUT direction mapping and STANDBY when data is stale/unclear.
2. Implement a secure Android device API/auth path to Main Market backend without exposing Twelve Data or Telegram bot secrets.
3. Replace OCR UI with the minimal logo ON/OFF + live market information screen.
4. Implement FCM registration, durable server-side device registration, CALL/PUT push dispatch, per-candle dedupe and notification deep links.
5. Add Android notification permission/channel handling and sound/vibration behavior.
6. Run Node tests, Android debug build, backend integration tests, and FCM test delivery.
7. Verify on Xiaomi 11T Android 14 with app foregrounded, backgrounded, swiped from Recents, screen locked, and after server restart. Record limitations for force-stop and OEM battery restrictions.
8. Update this handoff and commit every material change. Do not claim APK ready, push working, Render deployed, or device-tested without corresponding evidence.

## Immediate external prerequisite
- User needs to create/select a Firebase project, add an Android app with application ID com.aiuniversal.signalradar, and provide its google-services.json through a secure project file/secret workflow (not pasted into chat). Server service-account JSON must be added to Render as a secret, never to GitHub.