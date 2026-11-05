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

## Future Simulation Engine — isolated research branch (2026-11-05)
- Development branch: `feature/future-simulation-engine`; exact base remains `d260d68368a91f07eb9ab65f2e305bb02f08a143`. Branch is 15 commits ahead / 0 behind at the latest verified comparison.
- Added experimental `simulation/future-simulation-engine.js`, `simulation/simulation-safety-gate.js`, `simulation/index.js`, and deterministic tests. These files are not wired into `server.js`, `engine/analyze-market.js`, or the production Decision Engine.
- Added offline `scripts/backtest-m1.js`, `tests/backtest-m1.test.js`, and `npm run backtest:m1 -- <EURUSD_M1.csv> [report.json]`.
- Parser supports header-based UTC OHLC CSV and HistData Generic ASCII M1 rows (`YYYYMMDD HHMMSS;open;high;low;close;volume`). HistData timestamps are fixed EST (UTC-5) without DST and are converted to UTC.
- M1 replay is explicitly a coarse next-M1-candle range diagnostic. It cannot calibrate the engine's 10/20/30-second projections. Exact horizon calibration requires tick/second-level data.
- Data source inspected: https://www.histdata.com/download-free-forex-data/ (EUR/USD M1 and tick/second-level files are listed). The 2025 M1 archive page uses a JavaScript download action; browser inspection did not confirm a ZIP download. No historical data has yet been loaded and no empirical backtest/threshold calibration has been completed.
- Local isolated parser/harness smoke tests passed against stubbed analyzer/simulation dependencies; this is not a full repository test run. GitHub commit status returned no CI statuses. Do not claim full suite green.
- Production Render remains on commit `d260d68368a91f07eb9ab65f2e305bb02f08a143`, deployment `dep-dbll98lt1l0c73dn92ng`, status `live`; do not change its branch or deploy this research branch until separately approved.
- Next: obtain EUR/USD M1 history plus 1-second/tick history, verify provider timestamps/spread conventions, run in-sample/out-of-sample replay, report fakeout capture vs good-signal loss by threshold, then discuss integration only after stable results.

- Added `scripts/backtest-ticks.js`, `tests/backtest-ticks.test.js`, and `npm run backtest:ticks -- <EURUSD_TICKS.csv> [report.json]`. The parser accepts HistData Generic ASCII `YYYYMMDD HHMMSS;bid;ask` and header-based timestamp/bid/ask CSV, converts fixed EST (UTC-5, no DST) to UTC, validates quotes and monotonic timestamps, and aggregates mid-price ticks into M1 candles.
- Tick replay evaluates each minute boundary using only the preceding 200 completed M1 candles. It enters CALL at ask / PUT at bid and measures subsequent executable-side bid/ask path excursions separately at 10s, 20s and 30s. Entry delay >2s and insufficient horizon coverage are excluded and counted.
- The tick replay harness is prepared but has not yet been run against real historical tick data. Synthetic unit-test fixture and committed tests are present; no full test run or CI success is claimed.

## Future Simulation / Projection implementation update — 2026-11-05

- Updated `simulation/future-simulation-engine.js` to deterministic ATR + weighted 3-interval momentum + volatility-envelope scenarios for 10s/20s/30s. It requires valid completed OHLC candles and returns UNAVAILABLE on invalid/insufficient input. No random walk or generated market prices are used.
- Added `simulation/projection-engine.js`: derives UP/DOWN/NEUTRAL direction, lower/upper scenario bounds, continuation level, and LOW/MEDIUM/HIGH uncertainty. It deliberately does not emit probability percentages or claim statistical confidence intervals.
- Added `simulation/decision-adapter.js` and exported it from `simulation/index.js`. `analyzeWithProjection()` calls the existing `analyzeMarket()` and attaches simulation/projection diagnostics without modifying the original CALL/PUT/STANDBY decision. The Safety Gate remains opt-in and is not wired into production signal publication until empirical validation supports a calibrated threshold.
- Added `tests/projection-engine.test.js` covering deterministic output, ATR warmup, increasing envelope with horizon, uncertainty output, invalid-data fail-closed behavior, and preservation of the existing Decision Engine signal.
- Existing validation harnesses remain `scripts/backtest-m1.js` (coarse next-M1 range diagnostic only) and `scripts/backtest-ticks.js` (bid/ask tick replay at 10s/20s/30s with threshold capture vs good-signal loss). They enforce chronological input and construct features from candles available before the outcome window. No actual historical tick dataset has been replayed yet; no threshold calibration, profitability, or live validation is claimed.
- Changes are isolated on `feature/future-simulation-engine`; production `main` and Render configuration were not changed. No deployment was initiated.
- GitHub commits created for this update: `94a66947dd6ee1f292fc27ea95812b0f62501c76`, `f37a45dfe082a1c1c3ffad49ede81b7e4c932ce6`, `7fe47981acaa8c651394e0398307981afd8410a6`, `84530bcf88f31abc0d4acd8ce9752ff9518778bd`, `dfe29f8492da80852651ccb2c0ce03a33dac9982`, `df4c66b37779387c6bccfe4974c4158bead98bed`, `350d524f2ca3555520e8772e960b05ca88d03349`.
- Verification status: source files and test definitions committed; the full `npm test` suite and GitHub Actions CI have not been run in this session. Treat the branch as implementation-complete but not test-verified.

## Tick Backtest / Test Runner status — 2026-11-05

- Added `.github/workflows/node-tests.yml` to run `npm ci` and `npm test` on pushes and pull requests targeting `feature/future-simulation-engine` (commit `e71e9869a610d4c1a93920e605142d189df31617`).
- The GitHub commit status endpoint returned no statuses and the workflow-run lookup returned no runs for this commit at verification time. Therefore the suite is NOT confirmed passing.
- A local checkout/test attempt could not run because this execution environment could not resolve `github.com`; no npm test result is claimed.
- No actual EUR/USD tick CSV is available in the current conversation or repository checkout. The previously obtained HistData archives were EUR/USD M1 candle archives, which cannot validate 10/20/30-second bid/ask paths. `scripts/backtest-ticks.js` requires timestamp + bid + ask tick rows (HistData Generic ASCII `YYYYMMDD HHMMSS;bid;ask` or header-based CSV).
- Real tick replay remains pending receipt of an actual EUR/USD tick dataset. Do not run the M1 archives through the tick parser or substitute synthetic fixtures as empirical results.

## Automated Historical EUR/USD Data Pipeline — 2026-11-05

- Added `scripts/download-historical.js`: resumable UTC-hour downloader for EUR/USD Dukascopy BI5 tick files. Defaults to the previous 30 complete UTC days, accepts `--from YYYY-MM-DD --to YYYY-MM-DD`, caps each run at 366 days, retries transient failures, caches existing non-empty hourly files, and treats HTTP 404 as missing hour (weekends/holidays).
- Added `scripts/decode-dukascopy-bi5.py`: decodes hourly LZMA-Alone BI5 records (20-byte big-endian: ms offset, ask, bid, ask volume, bid volume; EUR/USD price scale 100000) into UTC `data/historical/EURUSD_ticks.csv` and bid-side M1 OHLC `data/historical/EURUSD_M1.csv`.
- Added npm commands: `npm run data:download -- --from YYYY-MM-DD --to YYYY-MM-DD`, `npm run data:decode`, and `npm run data:prepare`. Tick backtest now defaults to the generated tick CSV and writes `data/historical/reports/tick-backtest-report.json`.
- Added `data/historical/README.md` with instructions, source limitations, sample commands, and safety criteria. Added `.gitignore` rules so large raw files and generated reports are not committed.
- CI workflow changed from `npm ci` to `npm install` because this branch has no package-lock.json; cache setting still uses npm.
- Data source is Dukascopy public historical quote data, not Twelve Data or the user's broker feed. Broker spread/execution differences remain. Missing hours are not fabricated. M1 bars are aggregated from bid ticks and cannot validate 10/20/30-second outcomes.
- Important verification status: code is committed, but the downloader/decompressor have NOT yet been executed against a live BI5 sample in this environment, and the real-data backtest has NOT been run. No accuracy percentage is available. The complete npm test suite is NOT confirmed green until GitHub Actions reports success.
- Safety Gate remains research-only and disabled in production. Do not connect it to production until CI passes, real tick decoding and coverage are verified, a meaningful out-of-sample backtest is completed, and falseout capture versus good-signal loss is reviewed.

- Added `.github/workflows/historical-backtest.yml` with manual `workflow_dispatch`: runs `npm test`, downloads the requested UTC date range (or defaults to 30 days), decodes Tick + M1, runs both backtests, and uploads CSV/JSON outputs as a 14-day GitHub Actions artifact. This provides a cloud runner path; it has not yet been dispatched or completed.
- Historical backtest workflow now also triggers on pushes to `feature/future-simulation-engine` (latest workflow commit `fc6fcea47767d0398e11acfa9bbe4a16bab9c1d8`). The latest commit status query still returned no CI statuses at check time; wait for the Actions run before claiming success.
