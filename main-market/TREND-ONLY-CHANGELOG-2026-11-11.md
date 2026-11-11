# TREND ONLY change log — 2026-11-11

## Goal
Prevent counter-trend entries and suppress all directional signals unless a clear M1 trend is confirmed.

## Signal rules
- CALL only when trend classification is UPTREND and the last 12 closed candles confirm both higher highs and higher lows (HH/HL), EMA5 is above EMA20, both slopes agree upward, ADX proxy is at least 16, sideway score is below 45, and volatility is not abnormal.
- PUT only when trend classification is DOWNTREND and the last 12 closed candles confirm both lower highs and lower lows (LH/LL), EMA5 is below EMA20, both slopes agree downward, ADX proxy is at least 16, sideway score is below 45, and volatility is not abnormal.
- SIDEWAY, UNCLEAR, TRANSITION, HIGH_VOLATILITY, weak trend strength, or conflicting structure: no CALL/PUT.
- Remove reversal/fade candidates. Eligible setup families are PULLBACK, CONTINUATION, and BREAKOUT_RETEST only.

## Preserved
- Twelve Data REST/Streaming and API pool.
- Telegram Mini App auth/session, polling and existing UI.
- T-10 PREPARE, T-5 finalization, fresh Streaming tick check and 30-second signal hold.
- Existing sound/vibration and recovery/outcome bookkeeping.
- No broker execution.

## Validation maturity
- Local trend-only unit tests: 6 passed.
- Full repository CI and production deployment must pass before this change is live.
- No out-of-sample accuracy or profitability claim.
