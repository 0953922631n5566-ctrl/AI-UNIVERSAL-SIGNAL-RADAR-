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
- Trend-following threshold: 60 on the evidence scale. UPTREND and DOWNTREND share `strategies/trend-continuation.js` so CALL and PUT use the same mirrored candle-body (>=30% of range), close-strength (>=68% toward candle extreme), prior-close continuation, DI/MACD alignment and six-part evidence scoring. Strong directional continuation can pass short-term opposing S/R symmetrically at score >=60 with ADX >=20 and aligned DI/MACD/RSI. UNCLEAR always returns STANDBY; volatility ratio >2.8 always blocks and >2.2 blocks without strong aligned trend momentum.
- CALL/PUT is exposed only while countdownSeconds <= 5 (final five seconds of the current M1 clock window).
- Signal is keyed to the latest fully closed candle and is deduplicated on the Android client by candleTime + signal.
- Server must not send alerts to any third-party messaging platform.

## Modular Dynamic Trend Scanner Engine (2026-11-04)
- Added CommonJS modules under indicators/, scanner/, strategies/, and engine/; server.js remains the HTTP/data-provider entry point.
- Scanner requires 200 closed M1 candles. It classifies UPTREND, DOWNTREND, SIDEWAY, REVERSAL, or UNCLEAR. Missing/incomplete indicators and UNCLEAR fail closed to STANDBY.
- Indicators: EMA 9/21/50/200, RSI14, MACD, ADX with DI+/DI-, volatility range, and rolling support/resistance.
- Strategy router invokes only the module matching the detected regime. UPTREND and DOWNTREND use a shared mirrored continuation evaluator: directional body >=30% of candle range, close >=68% toward the candle extreme, close beyond prior close, and aligned DI/MACD; minimum score is 60 from six equally weighted evidence checks. Strong aligned trend momentum (ADX >=20, directional DI, MACD sign, RSI 22–78) can bypass nearby short-term opposing S/R symmetrically when candidate score >=60. Volatility ratio >2.8 always blocks; ratio >2.2 blocks unless strong trend momentum is confirmed. UNCLEAR always returns STANDBY. SIDEWAY and REVERSAL routing remain separate.
- Two-tier RAM cache: existing 15-second Twelve Data candle cache plus a process-local analysis cache keyed by latest closed-candle timestamp. Repeated APK polling reuses the computed analysis for that candle.
- Existing GET /api/market, /health, /api/connection, API key rotation/failover, closed-candle filtering, stale-data checks, final-five-second gate, and no-auto-trading policy are retained.
- RAM caches and key health are process-local and reset on Render restart. The final-five-second window is not a guarantee of end-to-end notification delivery; verify with live traffic and physical device.
- Automated tests: `npm test` (Node built-in test runner); test file: tests/modular-engine.test.js. A successful GitHub commit is not evidence that tests or a Render deployment passed.

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


## Round 16 Main Market Adapter + fail-closed Safety Gate (2026-11-05)
- Added `engine/main-market-adapter.js` between the existing EUR/USD M1 analyzer and the server Decision Engine output.
- Locked Round 16 profile in `engine/round16-parameters.js`: evaluation interval 30,000 ms; normalized risk maximum 0.70; volatility ratio maximum 1.50; minimum ADX 22; range/ATR maximum 1.25.
- Added `engine/simulation-adapter.js` and `engine/safety-gate.js`. Directional CALL/PUT requires a real Simulation provider result marked ready, matching the same closed-candle timestamp and direction, with all four required numeric metrics inside the Round 16 limits. Missing, invalid, stale/mismatched, throwing, or disagreeing Simulation results fail closed to STANDBY.
- No future-simulation provider currently exists in this branch; therefore the adapter intentionally returns NOT_CONFIGURED and the live API remains STANDBY until a real Simulation implementation is connected. No simulated or random data is invented.
- Server `GET /api/market` continues to serve the existing Android polling client and now also returns `safetyGate`, `simulation`, and `parameters` diagnostics. The APK remains unchanged: approximately 1-second polling and local notification only; no FCM, OCR, MediaProjection, or image upload.
- Existing Twelve Data multi-key rotation remains server-side through `TWELVE_DATA_KEYS` (comma-separated, up to the configured number of keys); keys are never returned to APK. Confirm the Render environment has all 10 values configured before asserting 10-key rotation is live.
- Tests added in `tests/safety-gate.test.js` for fail-closed behavior, same-candle/direction confirmation, and each Round 16 threshold. Run `npm test` before deployment. Render deployment and physical Xiaomi notification behavior remain unverified until their respective checks complete.
