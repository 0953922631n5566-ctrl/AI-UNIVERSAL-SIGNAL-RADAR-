# Custom Candle Lines — EUR/USD M1

This strategy uses no technical indicators. It derives its own price levels from real Twelve Data M1 OHLC and the current live candle.

## Lines calculated locally

- Confirmed swing support and resistance from completed candle pivots.
- Micro-range high and low from the latest eight completed candles.
- Range midpoint / balance line.
- Adaptive trigger lines above and below the micro-range, with a small buffer derived from the median raw candle range.
- Projected diagonal support and resistance lines from the latest two confirmed swing pivots.

## Candle events

- Sweep and reclaim: price pierces a structural line and the candle closes back through it with a rejection wick.
- Breakout: the candle closes beyond a custom trigger line with directional body and strong close location.
- Retest: price revisits a broken structural line and closes back through it.
- Engulfing breakout: the live candle engulfs the previous candle body and clears the micro-range.
- Diagonal trendline break: the live candle closes beyond a projected line with directional body confirmation.

The engine assigns heuristic structure points to line events, candle body, close location and wick rejection. A direction is eligible at 80/100; simultaneous CALL and PUT triggers are rejected as a conflict. This score is not a probability or proven win rate.

## Safety and execution

- EUR/USD, Non-OTC, M1 only.
- Real Twelve Data OHLC and Streaming prices; no synthetic candles.
- The live tick must be no older than five seconds when checked.
- WATCH remains at seconds 50–54; final ORDER check remains at seconds 55–59.
- Signal lamp remains visible for 30 seconds.
- Manual decision support only. No broker order execution.
- The 80-point threshold and line parameters require forward testing and outcome logging before any accuracy claim.
