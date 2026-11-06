# Android 1.6.0 — Zero-configuration receiver
- Main Market branch; app opens the hardcoded Render control dashboard without URL/token entry.
- Foreground dataSync service polls the JSON API at /api/public/signal every 15 seconds. /signal is HTML and is not a JSON API.
- UI displays the sanitized ten-slot API pool status only; secret API key values are never returned to the client.
- CALL/PUT alerts are deduplicated by symbol + signal + signal expiry; STANDBY never alerts.
- Android 13+ notification permission is required. Xiaomi HyperOS may require autostart/background and unrestricted battery settings.
- Android 15 limits dataSync foreground services to six cumulative hours per 24 hours. This is not guaranteed 24/7 polling; FCM is preferred for durable delivery after backend Firebase Admin is configured.
- No broker execution. Signals remain manual, rule-based decision support without independent out-of-sample profitability validation.
- CI build and physical-device verification are pending.
