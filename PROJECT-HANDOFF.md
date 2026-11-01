# AI UNIVERSAL SIGNAL RADAR — Project Handoff

**Architecture baseline approved:** 2026-11-01  
**Implementation status:** Requirements documented. No source code, backend, APK, or live tests completed yet.

## Product
Build a standalone Android APK. The APK is the only user-facing app; no Telegram Mini App. One START/STOP control. Broker-agnostic and market-agnostic: no routine broker, market, or symbol selection. The user opens a chart, starts the capture session, approves Android screen-capture permission, and the APK captures and sends frames automatically until STOP.

## Architecture
- **Android APK (eyes + display):** Android MediaProjection foreground capture service; capture frames during an approved session; upload images plus timestamp, sequence, session ID, dimensions/orientation and health metadata over authenticated HTTPS; retry transient failures; deduplicate; reject stale results; display status and CALL/PUT/STANDBY. Android may require a new permission for a new capture session or after OS revocation.
- **Backend (brain):** authenticated image ingestion; validate freshness/quality/order; queue and deduplicate; maintain temporal context across frames; run chart perception/OCR, regime classification, adaptive analysis, risk/decision checks, and continuous monitoring; return structured results to APK. Keep secrets server-side, never in APK or public GitHub.
- **No automatic broker orders.** Decision support only.

## Core intelligence: Situation-Aware, Event-Driven Adaptive Analysis
Do NOT use a rigid timer-driven, one-formula-every-minute scanner. Treat the latest frame as an observation in a continuous, stateful sequence:
1. Receive a new frame.
2. Validate image quality, timestamp, and freshness.
3. Compare with prior frames and update recent price/candle context.
4. Classify the situation: trend, range, breakout, high volatility, weakening trend, possible reversal, or unclear.
5. Adapt analysis methods and evidence weights to the detected situation.
6. Check conflicting evidence, volatility, data quality, and risk.
7. Emit CALL, PUT, or STANDBY only when explicit, testable conditions pass.
8. Continue monitoring; invalidate/downgrade/update signals when evidence expires or conditions change.

Examples:
- Trend: emphasize trend/momentum; avoid chasing an extended move.
- Range: reduce trend-following weight; assess range boundaries and false-break risk.
- Volatility spike: require confirmation; avoid premature entries.
- Reversal: detect weakening momentum/rejection and wait for confirmation.
- Poor/ambiguous/stale/conflicting data: STANDBY.

EMA, RSI, MACD, momentum, candle structure, support/resistance, volatility and price action are evidence tools, not a single immutable formula. Their use and weighting depend on regime and empirical validation.

## Event-driven responsiveness
New frames, detected price/candle changes, breakouts, volatility shifts, candle-close proximity, data-quality changes and signal invalidation can trigger reassessment. Capture cadence may adapt within device/network/backend limits. Screenshot sampling is not a direct tick feed; never claim tick-level real-time. Preserve sequence order and reject stale/out-of-order observations.

## Signal policy
- CALL: bullish evidence passes validated conditions for current situation.
- PUT: bearish evidence passes validated conditions for current situation.
- STANDBY: insufficient, stale, ambiguous, conflicting, or high-risk evidence.
Never force a signal. Do not fabricate confidence percentages; calibrate them on validation data or omit/label experimental. Include rationale, evidence, observation time, validity/invalidation conditions, and data-quality status. Prevent rapid CALL/PUT flips from OCR noise using temporal confirmation and hysteresis.

## Universal compatibility
Infer instrument, timeframe, price scale, candle area and chart context from the image when visible. Do not hard-code one broker's screen coordinates. If identification is unreliable, state uncertainty and use STANDBY. Universal compatibility is a goal to validate across chart layouts, not a guarantee for every broker.

## Testing / release gates
Test Android 14 MediaProjection/foreground service on Xiaomi 11T; upload/retry/dedup/stale ordering/reconnect; varied broker layouts, themes, zoom, orientations, assets and timeframes; labeled image-sequence evaluation for OCR/candle extraction, regime classification, false positives and latency; chronological backtests and out-of-sample/paper testing; verify uncertain inputs produce STANDBY. Publish APK only with exact build/version/hash and actual test results.

## Exclusions
Do not revive or modify legacy OCR/Signal Radar repos or Render services without a separate request. User said prior assets were deleted and wants a new project from scratch. No Telegram Mini App, no manual image uploads in normal operation, no routine broker/market selection, no paid market-data API dependency, no secrets in APK/public source, no automatic trading.

## Next steps
1. Initialize this separate repository.
2. Implement backend ingestion, health/status, session/frame handling, and conservative STANDBY-first analysis interface.
3. Implement APK START/STOP, MediaProjection permission, foreground capture, HTTPS upload, result display and reconnect.
4. Implement temporal situation-aware analysis and test harness.
5. Deploy backend, configure secrets securely, build/test APK on Xiaomi 11T.
6. Update handoff notes after each meaningful change.

**Continuity:** Treat this as the approved baseline in future conversations. Continue from the implementation status above. Do not revert to Telegram Mini App, manual per-image uploads, broker selectors, fixed one-minute formula-only scanning, or automatic trading.
