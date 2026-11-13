# Early Bullish Reversal Shadow Test — 2026-11-13

Status: ISOLATED EXPERIMENT ONLY — NOT DEPLOYED

- Branch: `experiment/main-market-early-bullish-reversal-shadow-20261113`, based on `main-market`.
- Target failure mode: a PUT released near the end of a bearish move, followed immediately by a bullish M1 target candle.
- Added a diagnostic-only detector using prior bearish run length, lower-wick rejection, candle-body contraction, close/low recovery, and EMA5 slope improvement.
- The detector is exposed as `shadowEntryGuard` in scoring output with mode `OBSERVE_ONLY`. It does not alter scores, thresholds, risk flags, CALL/PUT/STANDBY, T-10/T-5 timing, or signal hold.
- Tests cover a bearish rejection pattern, strong bearish continuation, a single misleading wick, invalid OHLC, and scoring integration.
- These are deterministic synthetic unit tests, not a historical EUR/USD backtest. No historical candle archive or labeled signal-outcome dataset was available in the repository at test setup.
- Do not merge or deploy this experiment based on unit tests alone. Next validation requires chronological historical M1 candles with the exact signal decision timestamp and target candle OPEN/CLOSE, then out-of-sample comparison against V1.
