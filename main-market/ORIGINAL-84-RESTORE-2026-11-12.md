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
- GitHub Actions passed: 145 tests, 141 passed, 0 failed, 4 skipped.
- Render deploy `dep-dbqt0k5bedkc73c3tei0` reached LIVE on merge commit `50fb8a8a40cca0a3bc7ea821b7f7aaf08dbfee5f`.
- `/health` confirms ORIGINAL 84 LOCAL_PARTIAL_SCORING, 65/45 thresholds, 54 closed M1 candles (50+4), external AI disabled, and streaming required.
- Twelve Data pool: 10/10 available; Render logs confirm first live EUR/USD Streaming tick at 1.10859.
- Telegram Mini App endpoint is live; user-device retest remains pending.
- No verified win-rate or out-of-sample accuracy claim.
