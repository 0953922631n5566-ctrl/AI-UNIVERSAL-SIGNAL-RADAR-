# Accuracy Lab — TREND ONLY

- Production target: existing `main-market` Render service.
- Signal authority: `src/accuracy-lab/market-intelligence.js` is the sole CALL/PUT directional analyzer.
- Direction policy: UPTREND with higher highs + higher lows (HH/HL), aligned EMA5/EMA20 and adequate trend strength may produce CALL only.
- Direction policy: DOWNTREND with lower highs + lower lows (LH/LL), aligned EMA5/EMA20 and adequate trend strength may produce PUT only.
- Sideway, unclear, transition, high-volatility, weak-strength, or conflicting-structure conditions return no directional setup.
- Counter-trend REVERSAL candidates have been removed from the signal authority. Only PULLBACK, CONTINUATION, and BREAKOUT_RETEST trend-following setups remain.
- The existing source-quality gate, Twelve Data REST + Streaming, API key pool, Telegram Mini App authentication/session, polling, T-10 PREPARE, T-5 CALL/PUT finalization, fresh-tick check, 30-second signal hold, and sound/vibration UI are preserved.
- The separate Reversal Radar panel remains diagnostic only and does not vote on or release CALL/PUT.
- This is a deterministic rule-based prototype, not a proven profitable strategy. No win-rate guarantee is made. Historical replay, out-of-sample evaluation, and forward paper testing remain necessary before relying on performance claims.
- No broker order execution is implemented.
