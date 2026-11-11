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


## FULL MARKET INTELLIGENCE — shadow-only extension

- Added `src/accuracy-lab/market-intelligence.js` to the same Accuracy Lab branch.
- Evaluates closed M1 candles only and requires at least 40 valid candles.
- Diagnostics: trend regime, Sideway risk, ADX proxy, EMA5/EMA20 slope, ATR expansion/compression, candle body/wicks, swing structure, false breakouts, pullback, continuation, breakout and retest candidates.
- The module returns a shadow setup candidate or a wait/no-trade guard. A candidate is not an instruction to trade and has not been proven profitable.
- Integrated as `marketIntelligence` in the existing Mini App feed. It does not modify the production analyzer result, ORIGINAL 84 decision authority, alerts, T-10/T-5 timing, or broker execution.
- Validation still required: full CI, historical replay without look-ahead, out-of-sample evaluation, and forward paper testing by CALL/PUT and regime.
