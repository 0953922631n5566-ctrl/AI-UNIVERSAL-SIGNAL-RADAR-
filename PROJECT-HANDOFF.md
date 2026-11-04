# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-04

## Dynamic Twelve Data API key failover (v1.3.0)
- Set Render Environment Variable `TWELVE_DATA_KEYS` to comma-separated API keys. Legacy `TWELVE_DATA_API_KEY` remains a single-key fallback. Never expose key values to APK or logs.
- Server rotates through configured keys. HTTP 429 marks `RATE_LIMITED` for 60 seconds; quota-style 403/provider quota messages mark `DEPLETED` until next UTC day; other errors are temporarily skipped. The next eligible key is attempted in the same request.
- API responses include redacted `apiKeys` totals and per-key index/status only. No key string is returned.
- All depleted => HTTP 503 + STANDBY + `All API Keys Depleted`; all unavailable for mixed reasons => `All API Keys Unavailable`.
- Status is in-memory and resets on Render restart. Quota classification relies on provider error response; no guaranteed quota-balance API is assumed.
- APK v1.3.0 shows dynamic key rows and summary, and parses error JSON so 503 quota state is visible.

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
- Current source version: 1.3.0 / versionCode 7.
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
- The 15-second server cache protects Twelve Data quota; APK polling does not mean Twelve Data is called every second. Each key has a 10-second minimum request interval.

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
