# Signal Radar PRO — Analytics / M5 Upgrade Addendum
Date: 2026-11-06
Branch: `feat/pro-analytics-mtf-filter` (proposed for `main-market`)
Target app version: Android `1.11.0`, build code 14

## Changes in this upgrade
- Raised Original AI final decision minimum from 35 to 60.
- Raised the trend-regime scanner ADX threshold from 14 to 18.
- Raised directional trend-entry ADX confirmation to 22.
- Sideways/ranging market candidates are now forced to STANDBY, even if a strategy emits a high score.
- Added a locally-derived M5 confirmation layer using completed M1 candles already held by the backend. This does not add Twelve Data API requests or consume another symbol feed.
- M5 direction requires EMA9/EMA21 alignment, close on the matching side of EMA21, and EMA21 slope confirmation.
- CALL/PUT candidates require matching M5 direction; trend candidates additionally require aligned DI, MACD histogram, RSI band, ADX, and minimum score.
- Increased strictness around volatility expansion; extreme volatility remains blocked.
- Exposed M5 direction and reason in the API analysis result and dashboard.
- Hardened Android Master OFF so a polling response that finishes after the user switches OFF is discarded before alerting or updating monitoring state. The active HTTP connection is volatile and is disconnected during service teardown.
- Bumped Android build code to 14 while retaining the requested app version label 1.11.0.

## Existing v1.11.0 features retained
- Firebase FCM topic subscription for Main Market signal events.
- Large CALL/PUT in-app dialog and floating overlay, subject to Android Display over other apps permission.
- Shared alert-ID deduplication between FCM and polling.
- Separate CALL/PUT sound and haptic patterns; STANDBY is silent.
- Persistent local Master ON/OFF preference; OFF stops local polling service, local HTTP connection, executor, wake lock, overlay, and FCM topic subscription.

## Important limits
- Master OFF is device-local. It does not stop the shared Twelve Data WebSocket running on Render, because that feed serves the backend and other clients. A per-device server lease/stop endpoint would be needed for server-side resource isolation.
- Android cannot guarantee sound/vibration against user volume settings, Do Not Disturb, OEM battery policies, or notification restrictions. The app does not bypass these OS controls.
- M5 is derived from the same M1 candle history; it is a second timeframe aggregation, not an independently sourced market feed.
- These are stricter heuristic filters, not a trained model or proof of predictive accuracy. No claim of win rate, false-positive reduction, or profitability is valid without chronological backtesting and out-of-sample / paper-trading evidence.
- Overlay, sound, haptic, and Master OFF behavior still require physical-device verification on Xiaomi 11T / Android 14.
- Debug APK signing keys are not stable across GitHub Actions runs. In-place installation may require uninstalling the previous debug APK unless a stable release keystore is configured and approved.

## Verification checklist
- [ ] GitHub Node test suite passes on PR and merge.
- [ ] Android Gradle build succeeds; apksigner verifies; SHA-256 recorded.
- [ ] Render deploy reaches live and health endpoint is checked.
- [ ] Xiaomi 11T tests: CALL/PUT overlay, STANDBY silence, duplicate suppression, Master OFF/ON lifecycle, and sound/vibration toggles.
- [ ] Chronological historical backtest and out-of-sample validation before describing strategy performance.
