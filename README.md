# AI Universal Signal Radar

Main Market EUR/USD M1 signal service and Android notification client.

## Android PRO app
Native Kotlin / Jetpack Compose project: `android/`.

Features:
- Editable Render server URL in app Settings.
- Direct signal polling from `GET /api/market`.
- Health check via `GET /health`.
- User-enabled foreground monitoring while app is backgrounded.
- Local BUY/SELL notifications with sound, vibration, and per-candle duplicate protection.
- Telegram API is not used by the Android app.

### Build APK
GitHub Actions builds an installable debug APK on pushes to `feature/server-price-extraction` that change Android files, or by manual workflow dispatch.

Artifact name: `signal-radar-pro-debug-apk`.

## Server API
- `GET /health`
- `GET /api/connection`
- `GET /api/market`

Default server: https://ai-universal-signal-radar-main.onrender.com

The server remains Main Market / Non-OTC / EUR/USD M1. No broker auto-trading is implemented.

## Background behavior
Enable **BACKGROUND ALERTS** inside the app. Android displays an ongoing foreground-service notification while polling. Android 13+ notification permission is required. Force-stop, battery restrictions, and Android 15's dataSync foreground-service time limit can interrupt continuous polling; guaranteed 24/7 delivery would need a push provider such as Firebase Cloud Messaging.
