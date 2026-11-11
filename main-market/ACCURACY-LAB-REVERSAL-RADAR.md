# REVERSAL RADAR — Accuracy Lab only

- Base: ORIGINAL 84 / PR #84 merge commit `18853e9f529254e9be5f7d4d8328543a7833e99d`
- Branch: `accuracy-lab/reversal-radar-original-84-20261111`
- Scope: a standalone diagnostic for possible M1 reversals in both directions.
- Production analyzer, score weights, CALL/PUT decision, T-10/T-5 timing, signal hold, Mini App, authentication, Twelve Data pool, sound, vibration, and notifications are not modified.
- The module is not imported by production code. It cannot change a baseline signal.
- Components: exhaustion/momentum fade, wick rejection/fakeout, EMA5 slope turn/reclaim, and swing structure break.
- A warning is not a confirmed reversal. Confirmation requires score threshold, a confirming close, and either a structure break or a slope turn with rejection evidence.
- This is a research hypothesis, not a validated trading edge. Unit tests alone do not authorize promotion.
- Release gate: run full CI, replay the same historical closed M1 candles against ORIGINAL 84, compare CALL and PUT separately and signal coverage, then forward paper-test. Only then request separate production promotion approval.
