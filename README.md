# AI UNIVERSAL SIGNAL RADAR — MAIN MARKET

This project is operated directly through the Android APK on mobile devices only. It does not use Telegram.

- Original AI is the sole Decision Engine.
- Historical Simulation runs alongside it in a separate advisory Worker Thread; it never overrides Original AI.
- EUR/USD only, real Non-OTC market, 1-minute candles.
- Twelve Data REST history plus server-side live price WebSocket.
- CALL / PUT / STANDBY only. Manual decision support; no broker order execution.
- The Android APK loads the same-origin HTTPS client and stores the device credential encrypted with Android Keystore.

## Backend

- Branch: `main-market`
- URL: https://ai-signal-radar-main-market.onrender.com
- Render build: `cd main-market && npm install`
- Render start: `cd main-market && npm start`
- Configure `TWELVE_DATA_API_KEY` and `ANDROID_CLIENT_TOKEN` as Render environment secrets only. Never put either secret in source code or the APK.

## Android APK

- Project: `main-market/android`
- Build workflow: `.github/workflows/android-apk.yml`
- First launch requires the device connection credential; the APK stores it with Android Keystore and exchanges it for an expiring Bearer session over HTTPS.
- Build locally from the Android project directory with JDK 17, Gradle 8.9 and Android SDK 35.

The decision logic is a transparent rule-based engine, not a proven profitable strategy. Validate live feeds and signal behavior on the target device before relying on signals.
