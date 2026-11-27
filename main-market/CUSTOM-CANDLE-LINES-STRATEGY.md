# Custom Candle Lines — EUR/USD M1

This strategy uses no technical indicators. It derives its own price levels from real Twelve Data M1 OHLC and the current live candle.

## Lines calculated locally

- Confirmed swing support and resistance from completed candle pivots.
- Micro-range high and low from the latest eight completed candles.
- Range midpoint / balance line.
- Adaptive trigger lines above and below the micro-range, with a small buffer derived from the median raw candle range.
- Projected diagonal support and resistance lines from the latest two confirmed swing pivots.
- Per-candle body midpoint line from the immediately preceding closed candle.
- Previous upper/lower wick midpoint lines to detect wick defense and rejection.
- Previous-candle directional continuation lines projected by 25% of its body.
- Every active M1 candle is evaluated against these fresh per-candle geometry lines at the existing WATCH and ORDER checkpoints.

## Candle events

- Sweep and reclaim: price pierces a structural line and the candle closes back through it with a rejection wick.
- Breakout: the candle closes beyond a custom trigger line with directional body and strong close location.
- Retest: price revisits a broken structural line and closes back through it.
- Engulfing breakout: the live candle engulfs the previous candle body and clears the micro-range.
- Diagonal trendline break: the live candle closes beyond a projected line with directional body confirmation.
- Body-mid cross: the current candle crosses the previous candle body midpoint with directional close confirmation.
- Wick defense: the current candle tests and reclaims the midpoint of a meaningful previous wick.
- Body continuation: the current candle crosses the previous candle directional continuation line.

The engine assigns heuristic structure points to line events, candle body, close location and wick rejection. The per-candle lines refresh from each newly completed M1 candle. A direction is eligible at 50/100 to increase M1 signal frequency. Directional raw-candle momentum can qualify when no structural line event fires; flat/doji candles remain WAIT, and simultaneous CALL and PUT triggers are rejected as a conflict. This score is a heuristic trigger threshold, not a probability or proven win rate.

## Safety and execution

- EUR/USD, Non-OTC, M1 only.
- Real Twelve Data OHLC and Streaming prices; no synthetic candles.
- The live tick must be no older than five seconds when checked.\n- One ORDER decision is attempted every M1 candle at seconds 55–59; the relaxed 50/100 threshold aims to increase frequency but cannot guarantee a signal on a flat/doji candle or stale feed.\n- During the first 30 seconds of the target candle, CALL is immediately cancelled if price breaks below the source candle body midpoint (minus a small geometry buffer); PUT is cancelled if price breaks above it. The Mini App reports FALSE_SIGNAL and the original signal must not be used.
- WATCH remains at seconds 50–54; final ORDER check remains at seconds 55–59.
- Signal lamp remains visible for 30 seconds.
- Manual decision support only. No broker order execution.
- The 50-point threshold and line parameters require forward testing and outcome logging before any accuracy claim. The false-signal guard is a price-structure invalidation rule, not a guarantee against losses.
