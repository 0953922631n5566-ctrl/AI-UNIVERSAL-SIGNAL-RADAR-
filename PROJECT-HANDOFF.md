# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-04
Branch: feature/server-price-extraction

## Canonical project scope
- Main Market (Non-OTC), EUR/USD, M1 only.
- Twelve Data REST candles are fetched by the Render server; API credentials never belong in the APK.
- No OCR, 8xTrade, OTC, broker order execution, Telegram integration, Telegram bot credentials, or Telegram notification endpoint.
- Android APK on the user's Xiaomi 11T is the sole alert destination.

## Server
- Node.js / Express service on Render: https://ai-universal-signal-radar-main.onrender.com
- Market endpoint: GET /api/market
- Health endpoint: GET /health
- Twelve Data candle cache: 15 seconds; API minimum-call guard: 10 seconds.
- Closed M1 candles only; stale/missing data fails closed to STANDBY.
- Signal threshold: 64 on the calibrated evidence scale, with existing regime, volatility, support/resistance, and direction-conflict filters.
- CALL/PUT is exposed only while countdownSeconds <= 5 (final five seconds of the current M1 clock window).
- Signal is keyed to the latest fully closed candle and is deduplicated on the Android client by candleTime + signal.
- Server must not send alerts to any third-party messaging platform.

## Android client
- Native Kotlin + Jetpack Compose app; application ID: com.kawasaki.signalradar.
- Current source version before this review: 1.2.1 / versionCode 5.
- Default server URL: https://ai-universal-signal-radar-main.onrender.com
- Foreground dataSync service polls GET /api/market on an approximately 1-second cadence while monitoring is enabled. Requests are sequential; actual interval includes request latency.
- Client accepts an alert only when signal is CALL or PUT, signalWindowOpen=true, and dataAgeMs <= 150000.
- Duplicate suppression key: candleTime + signal.
- Local Android notification uses a green CALL card or red PUT card, high-importance channel, app-generated alarm tone controlled by the sound switch, and notification vibration.
- This is background polling plus local Android notification, not FCM remote push.
- Required Android permissions include INTERNET, POST_NOTIFICATIONS, VIBRATE, FOREGROUND_SERVICE, and FOREGROUND_SERVICE_DATA_SYNC.
- Notification permission must be granted. User/device notification-channel settings, DND, volume, network, Android process controls, and Xiaomi HyperOS battery/autostart policies can still affect delivery.
- Force-stop prevents background restart until the user opens the app again. No 100% uptime guarantee.
- Xiaomi 11T / Android 14 physical-device verification is mandatory before claiming audible, vibration, heads-up, reboot, or long-duration reliability.

## Background service timing
- Polling cadence is approximately one second, with request latency included; requests have bounded connection/read timeouts.
- Render's final-five-second gate is authoritative. The APK does not independently calculate the M1 window.
- A slow/unavailable Render response can still miss a five-second window. Verify with live server and device tests.
- The 15-second server cache protects Twelve Data quota; APK polling does not mean Twelve Data is called every second.

## Build and verification
- GitHub Actions workflow: .github/workflows/android-apk.yml
- Build command: cd android && gradle --no-daemon assembleDebug
- Artifact name: signal-radar-pro-debug-apk (debug-signed APK, installable for testing; not Play Store release-signed).
- After source changes, verify CI success and artifact presence.
- Device test checklist: enable monitoring; grant notifications; verify green CALL/red PUT heads-up card; sound ON/OFF; vibration; duplicate suppression; screen off; app background; reboot; Xiaomi Autostart and battery settings.
- Do not claim physical-device testing unless the user confirms or a real device test is performed.

## Secrets and retired integrations
- Never print or commit API keys or tokens.
- Telegram integration is retired and must not be reintroduced: no Telegram send function, bot token/chat ID settings, notification token, endpoint, or delivery path.
