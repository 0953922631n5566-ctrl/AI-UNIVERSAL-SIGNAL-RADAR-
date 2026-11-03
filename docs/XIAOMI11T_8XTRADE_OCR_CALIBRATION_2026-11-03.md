# Xiaomi 11T 8xTrade OCR Calibration — 2026-11-03

## Scope and safety
This is an additive OCR workstream. The production Main Market Twelve Data Mini App and its existing signal/alert behavior must remain untouched. The target is a separate Android screen-capture -> authenticated backend -> OCR -> M1 candle -> manual signal path.

- Device: Xiaomi 11T, Android 14 / HyperOS.
- Broker screen: 8xTrade Traderoom, EUR/USD chart, 1-minute chart interval.
- Execution: manual only. Never place broker orders.
- Initial target: EUR/USD NON-OTC only. Reject or remain STANDBY if the market type cannot be verified. The supplied screenshot says "Digital" and does not visibly prove NON-OTC; do not classify it as NON-OTC from this image alone.

## Reference screenshot observations
User confirmed the chart will be open on the same Xiaomi 11T that runs the capture app.

- Screenshot dimensions: 1536 x 691 pixels.
- Orange floating/current-price badge text is visibly **1.118315**.
- Approximate badge rectangle in this screenshot: x=1234..1351, y=310..343 (right-side chart label, not a fixed coordinate for all device orientations/scales).
- Chart interval selector shows 1m.
- This is a calibration reference only, not a live quote feed. Never use this screenshot's price as current market data.

## OCR implementation requirements
1. Detect the orange price badge dynamically by color/shape and chart-relative position; do not hard-code the screenshot's pixel rectangle.
2. OCR only the badge digits. Validate EUR/USD decimal formatting and OCR confidence; reject ambiguous characters, multiple candidates, stale frames, duplicate/out-of-order frames, and implausible jumps.
3. Keep capture frame timestamp and sequence monotonic. The current backend /v1/frame endpoint only validates and stores frame metadata/hash and intentionally returns STANDBY with VISION_ADAPTER_NOT_CONFIGURED. It is not an OCR implementation.
4. Build one-minute OHLC candles from timestamped, validated price observations. Do not treat repeated screenshots of an unchanged badge as independent candle closes.
5. Signal engine must be trend-following; countertrend signals are suppressed unless a separately specified and validated rule permits them.
6. Display CALL / PUT / STANDBY and reason in the app/Mini App. Manual entry only.

## Warm-up policy requested by user
The user requests beginning analysis after 5 M1 candles rather than waiting for 60.
- At 5 completed candles, allow only explicitly labeled preliminary calculations/observations (e.g. EMA5 and short-term candle momentum).
- EMA20 is not mature with only 5 closes; RSI14 requires at least 15 closes for an initial value and preferably a longer warm-up; MACD(12,26,9) also needs substantially more history for stable interpretation.
- Until each required indicator has enough history and all freshness/market-type checks pass, keep final directional output at STANDBY. Do not fabricate or silently substitute indicator values.
- UI should distinguish WARMUP_5, INDICATORS_PENDING, READY, and STANDBY states.

## Current known integration gap
The current backend is a conservative FastAPI frame-ingestion shell. It has no OCR engine or chart-vision adapter and returns STANDBY. The Android app has not yet been verified to encode/upload frames and consume decisions. No APK from this workstream is ready for installation.

## Acceptance checklist before live use
- [ ] Android MediaProjection encodes JPEG frames and uploads over HTTPS.
- [ ] Backend authentication secret is configured only in Render environment variables; never embed it in APK or source.
- [ ] OCR reliably reads the orange badge on portrait and landscape captures, including movement/resizing.
- [ ] Market type is positively verified as NON-OTC; otherwise STANDBY.
- [ ] Timestamped prices produce correct M1 OHLC candles without duplicate-sample inflation.
- [ ] Warm-up and indicator readiness are correctly enforced.
- [ ] Directional rules are tested chronologically on out-of-sample data; no accuracy claims before measurement.
- [ ] App displays status, price age, CALL/PUT/STANDBY and reason.
- [ ] Android build and automated tests pass.
- [ ] Physical test completed on Xiaomi 11T with 8xTrade open on the same device.
- [ ] Existing production Main Market service remains unchanged.

## Branch
Work is isolated on `feature/xiaomi11t-8xtrade-ocr-nonotc`. Do not merge into main or deploy to the production Mini App until all acceptance checks pass.
