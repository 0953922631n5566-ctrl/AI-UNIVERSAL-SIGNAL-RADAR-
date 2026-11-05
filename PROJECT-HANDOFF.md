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


## Historical EUR/USD M1 Future Simulation (2026-11-05)
- Added `engine/future-simulation.js`: walk-forward historical analogue model using actual closed EUR/USD M1 OHLC candles fetched from Twelve Data. It matches the latest five-candle normalized-return pattern against earlier five-candle patterns and evaluates the next actual historical candle for each analogue. The current candle is not used as a historical outcome label.
- Uses 20–30 nearest historical analogues; requires at least 80 valid closed candles and at least 20 analogues. Outputs a derived indicative projected price (latest close plus historical mean move in ATR units), expected move in price units, and one-candle empirical scenario statistics: CALL/PUT/STANDBY direction, up/down frequency, expected and median move in ATR units, sample count, nearest-pattern distance, adverse-outcome risk, ATR, ADX, volatility ratio, and current range/ATR.
- This is an empirical scenario estimator, not a deterministic forecast or guarantee. Direction requires at least 58% analogue outcomes in one direction and matching signed mean move; otherwise it returns STANDBY.
- `engine/main-market-adapter.js` now runs the real historical simulation by default and supplies it to the existing Safety Gate. CALL/PUT must agree with Decision Engine, match the exact closed-candle timestamp, and pass Round 16: risk <= 0.70, volatility ratio <= 1.50, ADX >= 22, range/ATR <= 1.25.
- `GET /api/market` already serializes the adapter's simulation and safetyGate diagnostics; the APK polling contract and Local Notification implementation are unchanged. Signal availability remains controlled by the existing final-five-second window and client duplicate suppression.
- Tests expanded in `tests/safety-gate.test.js` for history validation, ATR feature construction, analogue result structure, same-candle/direction confirmation, all four gates, and default adapter integration. Must verify GitHub Actions and live Render deploy before claiming production readiness.
- Historical sample size is limited to the latest 200 closed M1 candles currently fetched by server configuration. For stronger statistical validation, increase outputsize or persist a larger real historical archive after confirming Twelve Data plan limits. Do not imply a 58% analogue rate is a calibrated probability.


## Verification snapshot after Historical Simulation deployment
- Render service `ai-universal-signal-radar-main` deployed successfully from `feature/server-price-extraction`; latest application code includes the empirical projected-price fields and API diagnostics.
- GitHub Actions `Server Modular Engine Tests`, run #29 for commit `3148c8fc15c464f872e3b385dda949116f86dab5`, completed successfully: 29 tests passed, 0 failed.
- Live `GET /api/market` was checked after deploy. It returned ONLINE, 10 configured API-key slots (1 ACTIVE, 9 READY), Simulation READY with 30 historical analogues, projectedPrice/currentPrice/expectedMovePrice fields, and Round 16 diagnostics.
- At the verification sample, market regime was SIDEWAY, ADX 12.45 (<22), historical analogue direction had no sufficient edge, and API signal was correctly STANDBY. This is expected safe behavior, not a failed deployment. CALL/PUT should only appear when both Decision Engine and Simulation agree and every Safety Gate threshold passes.
- APK source and package were not modified in this work. Existing polling/local-notification client remains the integration target; actual on-device notification and end-to-end CALL/PUT delivery still require physical Xiaomi 11T verification when a qualifying market setup occurs.


## Original Engine APK build (2026-11-05)
- Added dedicated GET /api/market/original endpoint. It runs the existing `engine/analyze-market.js` path (Market Context → Strategy Router → Decision Engine) directly and does not apply Future Simulation or Safety Gate filtering.
- Existing GET /api/market remains the enhanced path (Main Market Adapter → Future Simulation → Safety Gate). Both endpoints share the same Twelve Data candle fetch/cache but maintain independent per-mode analysis caches and signal-window state.
- Android polling client is configured to call `/api/market/original`; this APK is explicitly the ORIGINAL MODE client. The UI, background polling, local notifications, sound switch, duplicate suppression, and server URL setting are retained.
- APK version bumped to 1.4.0 / versionCode 8. Build artifact is a debug-signed test APK, not a Play Store release-signed package.
- Verify server tests, Android Actions build, Render deployment, and then live GET /api/market/original before telling the user it is ready. Physical Xiaomi 11T alert delivery still requires device testing.


## Round 16 Simulation-led tuning (2026-11-05)
- Future Simulation is now the primary source of CALL/PUT direction on GET /api/market. The original analyzer remains as regime, score, and indicator context; its separate CALL/PUT or STANDBY decision no longer vetoes a valid Simulation direction.
- Round 16 now requires at least 20 real historical analogues, directional frequency >=58%, a matching signed expected move, adverse-outcome risk <=0.70, and volatility ratio <=2.20.
- Removed ADX >=22 and candle Range/ATR <=1.25 as hard Safety Gate blockers. ADX and Range/ATR remain visible diagnostics; they do not independently suppress a Simulation-led signal.
- Hard blocks remain for invalid/unready history, candle timestamp mismatch, no directional edge, insufficient analogue count, inconsistent direction/expected move, excessive adverse-outcome risk, and extreme volatility.
- This tuning makes the simulation primary and reduces indicator vetoes; it does not guarantee more signals, accuracy, or profit. When analogue frequency is below 58% or expected move has no directional sign, STANDBY remains correct.
- Updated safety-gate tests cover Simulation overriding the original analyzer's STANDBY/opposite direction and the relaxed ADX/range rules. CI and Render deployment must be checked before production status is claimed.


## Future Projection Bar (2026-11-05)
- Future Simulation now emits `simulation.projectionBar`: a synthetic next-M1 OHLC scenario with open=current closed close, close=analogue expected projected price, and high/low padded by 0.25 ATR.
- The bar is explicitly tagged `synthetic: true` and `FUTURE_PROJECTION_NOT_MARKET_DATA`; it must never be presented as observed Twelve Data OHLC or a guaranteed future price.
- Safety Gate response summary passes this projectionBar through to /api/market for app/UI use.
- No forced CALL/PUT behavior was added. A weak directional lean alone is not treated as an actionable entry; no-edge, invalid/stale data, timestamp mismatch, or excessive risk remains STANDBY.
- Test suite now asserts projection bar timestamp and OHLC construction. Verify CI and Render auto-deploy before claiming production availability.


## Projection Bar API + Android integration follow-up (2026-11-05)
- Fixed `engine/safety-gate.js` serialization so the synthetic `simulation.projectionBar` object survives into `GET /api/market`. It is explicitly tagged synthetic and `FUTURE_PROJECTION_NOT_MARKET_DATA`.
- Added regression coverage that the projection bar survives the safety gate and that directional-frequency text is formatted as a percentage (e.g. 70.0%, not 0.7%).
- Android polling now stores the returned projection bar and simulation JSON in SharedPreferences; MainActivity renders the next-M1 synthetic OHLC scenario and labels it as a model projection, not live market data.
- Render service `ai-universal-signal-radar-main` is configured for automatic deploys from `feature/server-price-extraction`. The deploy containing the projection serialization fix was observed `live`; verify the latest follow-up commit's deploy separately.
- APK build workflow for commit `4c41ca767005ba6a0316e7c49dae5b61c795001b` was observed in progress at the last check. Do not claim the new APK is ready until workflow success and artifact presence are verified.
- Live API sample confirmed `simulation.projectionBar` present with OHLC, synthetic flag, and label. The same sample returned top-level `signal: STANDBY` because `signalWindowOpen` was false (outside the final 5 seconds of the M1 cycle); simulation direction was PUT with 60% historical analogue frequency and Safety Gate PASSED. This is a projection diagnostic, not permission to force an entry.
- Physical Xiaomi 11T install/notification test remains unverified. Debug APK signing may differ from the installed package signature; do not promise in-place upgrade or data preservation.
