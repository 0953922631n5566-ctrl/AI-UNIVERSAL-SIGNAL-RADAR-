# Engine 3 tuning — 2026-11-24

## Live diagnosis
- Render service: `ai-signal-radar-main-market` on branch `main-market`; service remained live and Twelve Data was responding.
- Live `/health`: 10/10 Twelve Data keys available; Engine 3 threshold 58, score lead 8, sideways gap 0.08 ATR; live analysis cadence 250 ms.
- Live `/api/public/signal` at 2026-11-24T01:48:59Z: monitoring=true, API=ONLINE, tick age 0s, 54/54 closed candles, EMA5/EMA20/ATR14 reported READY, but Engine 3 returned `TWELVE_DATA_INDICATORS_STALE` because the latest native indicator epoch was behind the latest closed M1 candle. This is a data-alignment blocker, not a missing API feed or low score.
- Existing Trend Rider also required swing structure or breakout even when EMA alignment and latest-candle momentum agreed, and only finalized in the final five seconds of the M1 candle.

## Changes in this branch
- Permit native EMA5/EMA20/ATR14 to lag the latest closed M1 candle by exactly one candle, only when all three indicator series share the same timestamp. Reject future, irregular, or two-plus-candle stale values.
- Add an auditable momentum-continuation trigger: aligned EMA5/EMA20 plus latest candle body momentum closing on the trend side of EMA5 can qualify without waiting for a new swing or breakout.
- Keep score threshold 58, score lead 8, sideways guard 0.08 ATR, late-entry guard 1.5 ATR, abnormal-range guard 2.8 ATR, fresh-stream requirement, and one-signal-per-candle behavior.
- Move definitive CALL/PUT finalization from T-5 to T-10; retain T-15 PREPARE as the early warning. Signal remains visible for 30 seconds after target M1 candle opens.
- Add explicit blocker diagnostics to Engine 3 results and one-per-candle server logs.
- Update health/API timing metadata and package architecture metadata.
- Add tests for one-candle indicator lag, rejection at two candles, momentum continuation without swing/breakout, and T-15/T-10 timing.

## Safety / validation
- Manual signals only; no broker execution, martingale, or OTC/OCR changes.
- This change increases responsiveness but does not prove predictive accuracy. Keep `SIGNAL_RELEASE_VALIDATED=false`; paper-test and measure signal frequency, missed entries, and win/loss outcomes before any real-money use.
