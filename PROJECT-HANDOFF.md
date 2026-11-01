# AI UNIVERSAL SIGNAL RADAR — Project Handoff

**Architecture baseline:** 2026-11-01  
**Implementation status:** Initial source scaffold committed. Not yet built, deployed, or device-tested.

## Product requirements
Standalone Android APK; no Telegram Mini App. One START/STOP workflow. Broker-agnostic and market-agnostic by design; no routine broker, market, asset or pair selection. User opens a chart, taps START, approves Android screen capture, and the app captures during that authorized session. STOP ends capture. Manual trading advice only; never place broker orders.

## Architecture
- Android APK: MediaProjection foreground service, consent prompt, frame metadata, authenticated HTTPS upload, result display, retry/dedup/stale-response protection.
- Backend: authenticated image ingestion, image quality/freshness/order checks, temporal frame context, chart perception/OCR, regime classification, adaptive analysis, risk/decision engine and signal invalidation.
- Secrets remain server-side. Never commit secrets or embed a private token in a public APK.
- Screenshot sampling is not a tick feed. Do not claim tick-level real-time.

## Intelligence policy
Situation-aware and event-driven, not a rigid timer-driven single-formula scanner. Compare sequential frames; identify trend/range/breakout/high volatility/weakening/reversal/unknown; adapt evidence; suppress decisions when image/data is ambiguous, stale, conflicting or risky. CALL/PUT require explicit testable and validated conditions. Otherwise STANDBY. Do not fabricate prices, candles, indicators or confidence. Use temporal confirmation/hysteresis to avoid noisy direction flips. Include rationale and invalidation conditions.

EMA/RSI/MACD, candle structure, support/resistance, momentum and volatility may be evidence tools; none is a universal fixed formula.

## Current code
- `backend/app.py`: health, session start/stop, bounded frame metadata/hash tracking, auth, JPEG/PNG and timestamp/sequence validation. Returns STANDBY because no vision model is configured.
- `android/`: initial Android 14 MediaProjection consent and foreground capture scaffold.
- The Android capture scaffold does not yet encode/upload frames or render backend decisions. Backend URL is a placeholder. No APK has been built.
- Android source needs compilation and lifecycle review before release.

## Next work
1. Complete Android frame encoding, upload, response parsing, retry/backoff and STOP/result UI.
2. Securely provision backend authentication and deploy backend over HTTPS.
3. Add a real vision adapter with structured perception outputs; keep STANDBY until validated.
4. Build test harness with labeled multi-broker image sequences and chronological/out-of-sample evaluation.
5. Build APK and test on Xiaomi 11T / Android 14, record exact artifact SHA-256 and test evidence.
6. Update this handoff after each meaningful change.

## Safety and release gates
No automatic trading. No fabricated signal/confidence. Do not release as production-ready before security, build, device, latency, image-perception, false-positive and out-of-sample tests. No paid resources without explicit cost approval. Legacy OCR and Telegram projects remain out of scope.
