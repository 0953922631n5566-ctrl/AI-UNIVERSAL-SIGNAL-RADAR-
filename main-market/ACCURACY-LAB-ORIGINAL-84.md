# ACCURACY LAB — ORIGINAL 84 Baseline

Date: 2026-11-11
Status: isolated research branch; NOT production
Repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`
Protected baseline: PR #84 merge commit `18853e9f529254e9be5f7d4d8328543a7833e99d`
Restored pre-accuracy baseline: `cea3bbc035969443483dba40a62cd8366e4604d0`
Experiment branch: `accuracy-lab/original-84-baseline-20261111`

## Non-negotiable safety boundary

ORIGINAL 84 is the rollback source of truth. Never commit experiments to `main-market`, never rewrite or force-push the protected baseline, and never merge or deploy an Accuracy Lab change without a separate explicit promotion decision.

The user explicitly requires every existing alert and notification behavior to remain unchanged. Treat the following as frozen interfaces:

- Telegram Mini App UI, authentication, session, transport, Start/Stop, and pair selection.
- Twelve Data API pool, REST/Streaming connection, failover, stale-price/data-quality checks.
- PREPARE/watch timing at T-10 and final CALL/PUT decision at T-5.
- Existing per-candle deduplication, signal invalidation/hold lifecycle, and 30-second display hold.
- Existing CALL/PUT notification delivery, sound, vibration, and background behavior.
- No Telegram chat messages, broker execution, OTC/OCR, or screenshot workflow.

Do not edit notification, timing, Mini App, auth, feed, API-pool, or server dispatch code as part of an analyzer experiment. If an analyzer change requires any of those edits, stop and redesign the experiment.

## Baseline audit

PR #84 is merged. Its merge commit is `18853e9f529254e9be5f7d4d8328543a7833e99d` and the PR body explicitly restores the tree to `cea3bbc035969443483dba40a62cd8366e4604d0`.

The restored analyzer is deterministic Partial Scoring:
- EMA5 slope/reversal: 30 points
- Support/resistance fakeout: 30 points
- Proximity/momentum: 20 points
- Trend context: 20 points
- CALL/PUT threshold: 65
- PREPARE threshold: 45
- Choppy and abnormal-ATR kill switches
- 54 closed M1 candles (50 context + 4 entry)

Existing timing tests encode T-10 PREPARE, T-5 finalization, fresh Streaming tick requirement, per-candle dedupe, and 30-second hold. These are regression contracts, not tuning targets.

## Accuracy Lab method

1. Preserve ORIGINAL 84 unchanged and develop only on this branch.
2. Capture/replay historical M1 candles with the same closed-candle window and the same next-candle entry/expiry convention used by the live system.
3. Establish an ORIGINAL 84 baseline report before tuning: CALL and PUT separately; wins, losses, flats, sample size, coverage/signal frequency, and outcomes by regime/volatility.
4. Test candidate filters in shadow/offline mode first. A candidate may label a baseline signal as rejected, but must not change live CALL/PUT decisions or notifications during research.
5. Prevent look-ahead bias: every feature for a signal must use only candles available at the decision timestamp; evaluate the next candle only as the outcome.
6. Split chronological data into development and untouched out-of-sample periods. Do not tune against the out-of-sample set.
7. Compare both accuracy and signal coverage. A filter that improves hit rate only by suppressing nearly all signals is not an acceptable improvement.
8. Require adequate samples and stable CALL/PUT results across multiple market regimes. Report confidence intervals and all exclusions.
9. Only after offline out-of-sample and forward paper testing may a candidate be proposed in a separate PR. Production promotion and Render deployment require a separate explicit user approval.

## Initial hypotheses to evaluate (not yet approved as live rules)

- Late-entry/overextension relative to ATR and EMA5.
- Weak candle body or poor close location / opposing wick.
- Directional score gap between CALL and PUT.
- Recent alternating candles / low directional efficiency.
- Signal quality conditioned on volatility and market regime.

These are hypotheses only. Do not assume any will improve results until measured on unseen data.

## Release gate

No Accuracy Lab code is production-ready merely because unit tests pass. A promotion proposal must include:
- Exact changed files and proof that frozen alert/UI/feed files are untouched.
- CI results and regression tests.
- Baseline vs candidate out-of-sample metrics, CALL/PUT separately, plus signal coverage.
- Forward paper-test results and known limitations.
- Rollback instructions pointing to ORIGINAL 84 / commit `18853e9f529254e9be5f7d4d8328543a7833e99d`.

Current status: branch created from ORIGINAL 84. No analyzer behavior, alert behavior, production branch, or Render deployment has been changed.
