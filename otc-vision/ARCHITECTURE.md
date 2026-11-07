# OTC Vision Signal Radar — Isolated Project Blueprint

**Status:** workspace initialized; architecture only. No APK built, no capture active, and nothing deployed.

## Isolation contract

- Work only on branch feature/otc-vision-apk.
- Branch created from repository main, not main-market.
- Never merge into main or main-market without separate explicit approval.
- Do not edit, call, configure, or deploy to the Main Market Render service.
- Do not reuse Main Market FCM, credentials, environment variables, backend endpoints, Twelve Data, Telegram, or server-side alert delivery.
- The inherited repository contains unrelated Main Market files and workflows. Treat them as read-only historical context. New OTC app code belongs under otc-vision/ with its own Android application ID, build configuration, tests, and release artifacts.
- Do not edit or dispatch the existing Render keep-alive workflow. Do not add any workflow that calls Render or sends FCM notifications.

## Product objective

A single-device Android app for Xiaomi 11T / Android 14. It observes a user-selected OTC trading screen, extracts price/candle information on-device, evaluates locally implemented strategies, and presents manual CALL / PUT / STANDBY alerts. It must not place trades or automate broker interaction.

## Proposed technology

- Kotlin, Android SDK, Gradle, Jetpack components.
- MediaProjection for explicit, user-approved screen capture.
- Android foreground service with the mediaProjection service type while capture is active.
- Google ML Kit Text Recognition, preferably the bundled on-device model for predictable offline availability.
- Android Bitmap/image processing for candle geometry and color extraction. OCR is for text/price labels, not candle-shape analysis.
- Room for local configuration, calibration, and bounded diagnostic history; no cloud sync.
- Android NotificationManager for local alerts, with locally bundled audio and vibration.
- Unit and instrumentation tests for parsing, feature extraction, strategy logic, and notification state.

## Runtime pipeline

1. **User-controlled session**
   - User opens the app, selects the target screen, calibrates the price-label and candle-chart regions, and explicitly starts capture.
   - Display a persistent capture indicator and a clear Stop control.
   - Stop capture immediately when the user stops the session, revokes projection, the service is stopped, or an unrecoverable capture error occurs.

2. **Screen capture and crop**
   - Use MediaProjection with a virtual display and ImageReader.
   - Crop only two configured regions of interest: current price label and candle chart.
   - Handle rotation, resolution changes, scaling, system bars, and stale frames.
   - Avoid Accessibility permissions for routine capture. Accessibility is not a general-purpose screen-capture API; only consider a narrowly scoped assistive feature after explicit approval.

3. **Price OCR**
   - Run ML Kit on the cropped price-label bitmap.
   - Normalize digits and decimal separators, reject ambiguous/multiple candidates, and validate against configured instrument tick/precision rules.
   - Attach capture timestamp, OCR confidence, and source ROI to every observation.
   - Require temporal consistency across successive frames. Never turn low-confidence or stale OCR into a price.

4. **Candle vision**
   - Detect chart bounds and candle bodies/wicks from pixels using color segmentation and geometry.
   - Infer direction, body size, wick lengths, and approximate OHLC only when scale calibration is reliable.
   - Mark chart-derived values as estimates. If axis scale, candle boundaries, or colors cannot be resolved confidently, return UNKNOWN rather than fabricate OHLC.
   - Build a time-ordered local candle buffer and reject duplicate, missing, out-of-order, or stale observations.

5. **Local market-state and 10-engine decision layer**
   - Port the ten AI-10 CORE micro-strategies only after reviewing the exact source implementation and mapping each strategy's inputs to data screen vision can genuinely provide.
   - Keep each strategy as a pure Kotlin component returning direction, evidence, validity, and reason; no network or Android UI dependencies.
   - Use a common feature snapshot: price series, estimated candles, momentum, volatility, support/resistance, and data-quality flags.
   - Aggregate evidence in a separate decision engine with regime awareness: trend, range, high volatility, reversal/unclear.
   - STANDBY is mandatory when OCR is ambiguous, frames/candles are stale or incomplete, calibration is invalid, strategies conflict materially, or the regime is unclear.
   - Never claim a confidence percentage unless a calibrated, tested probability model exists. No auto-trading, broker clicks, or order execution.

6. **Local alert delivery**
   - Use local Android notifications with a high-importance notification channel, sound, and vibration preferences.
   - Use heads-up presentation where Android permits. A draw-over-other-apps overlay is optional, separately explained, and explicitly enabled by the user. Do not abuse Accessibility services to force overlays.
   - Full-screen intents are restricted by Android and must not be assumed available. The app must work with ordinary heads-up notifications.
   - Deduplicate alerts by candle/session key, enforce expiry, and never sound for STANDBY.
   - Alerts are advisory and identify themselves as visual OTC screen analysis.

## Suggested project layout

    otc-vision/
      settings.gradle.kts
      build.gradle.kts
      app/
        build.gradle.kts
        src/main/AndroidManifest.xml
        src/main/java/.../
          MainActivity.kt
          capture/ProjectionCaptureService.kt
          capture/RegionCalibration.kt
          vision/PriceTextRecognizer.kt
          vision/CandleImageAnalyzer.kt
          vision/FrameQualityGate.kt
          data/LocalObservationStore.kt
          engine/FeatureSnapshot.kt
          engine/StrategyEngine01.kt ... StrategyEngine10.kt
          engine/DecisionAggregator.kt
          alerts/LocalAlertManager.kt
          settings/PrivacySettings.kt
        src/test/...
      docs/
        DATA_CONTRACT.md
        DEVICE_SETUP_XIAOMI_11T.md
        STRATEGY_PORTING_MATRIX.md

The package/application ID must be unique to this OTC app and must not reuse the Main Market app ID.

## Privacy, security, and network boundary

- Default network policy: no INTERNET permission and no network client dependency.
- No API keys, server URLs, Firebase, FCM, Telegram, Render, or remote analytics.
- Keep screenshots and OCR output in memory by default. If diagnostics are enabled, store only bounded, user-visible local records and provide a delete-all control.
- Do not persist or upload broker credentials, account balances, personal identifiers, or full-screen recordings.
- Capture must be user-initiated, visibly indicated, and stoppable at any time.

## Xiaomi 11T / Android 14 notes

- Android 14 requires fresh user consent for each MediaProjection session; do not cache or reuse a projection token.
- Declare the correct foreground-service permissions and foregroundServiceType=mediaProjection; follow Android 14 foreground-service start requirements.
- Test lock/unlock, app switching, orientation, screen-off, battery saver, memory pressure, permission revocation, and notification permission denial.
- Xiaomi/HyperOS may restrict background activity. Document user-controlled Autostart and battery settings only if testing demonstrates they are required; do not silently bypass system controls.
- Never promise uninterrupted capture when Android or the user has stopped projection.

## Delivery phases and acceptance gates

1. **Foundation:** isolated Gradle app, unique application ID, privacy boundary, session UI, permission flow. Build and install on Xiaomi 11T.
2. **Capture:** explicit MediaProjection, ROI calibration, frame throttling, lifecycle and stop behavior. Verify no capture outside an active session.
3. **Vision:** OCR price extraction and candle geometry with replayable test images; measure precision/recall and stale-data rejection.
4. **Strategy port:** inspect and map all ten source engines; implement unit tests and deterministic replay. Do not loosen thresholds just to force CALL/PUT output.
5. **Alerts:** local notifications, sound/vibration controls, deduplication, expiry, and STANDBY silence.
6. **Device validation:** long-run battery/thermal tests, HyperOS background behavior, screen rotation, and failure recovery.
7. **Release:** signed APK and SHA-256 checksum. No Render deployment, FCM setup, or merge to Main Market.

## Current verified state

- Git branch: feature/otc-vision-apk.
- Branch base: main at commit 02b77fe3357a2c0b708135b7cf280437b56781ac.
- No files on main or main-market were changed by this initialization.
- No Render or FCM action was performed.
- Architecture document only; Android implementation and APK remain pending.
