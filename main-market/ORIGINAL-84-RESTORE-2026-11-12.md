# ORIGINAL 84 Analyzer Restore — 2026-11-12

## Target
- Saved baseline commit: `18853e9f529254e9be5f7d4d8328543a7833e99d`
- Protected reference: `accuracy-lab/original-84-baseline-20261111`
- Restore branch: `rollback/original-84-production-20261112`

## Active analyzer
- ORIGINAL 84 deterministic Partial Scoring.
- 50 closed M1 context candles + 4 closed M1 entry candles.
- EMA5 Slope/Reversal: 30 points.
- Support/Resistance Fakeout: 30 points.
- Proximity/Momentum: 20 points.
- Trend Context: 20 points.
- CALL/PUT >= 65; PREPARE >= 45; otherwise STANDBY.
- Original Choppy and abnormal ATR kill switches.
- No Gemini or M5 LIVE + M1 Precision Entry decision path.

## Preserved integration
- Twelve Data real REST/Streaming source and API pool.
- Existing pair selector and Telegram Mini App session.
- T-10 preparation and T-5 final decision timing.
- 30-second signal hold.
- Manual decision support only; no broker execution.

## Validation
- Awaiting CI and production deployment/health verification.
- No verified win-rate or out-of-sample accuracy claim.
