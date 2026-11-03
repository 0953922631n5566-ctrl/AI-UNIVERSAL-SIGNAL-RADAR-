# Two-Candle Forecast — EUR/USD M1

## Purpose
Provide two independent directional assessments:
1. NEXT M1: the next one-minute candle.
2. FOLLOWING M1: the candle immediately after NEXT M1.

This is a rule-based forecast, not a trained AI model and not a guarantee of candle direction, trading success, or profit.

## Inputs and safeguards
- Main market only: EUR/USD, NON-OTC, M1.
- Uses the existing completed REST candles and the latest authorized Twelve Data WebSocket quote.
- Requires at least 35 completed candles.
- Requires an authorized, fresh WebSocket quote (maximum age 75 seconds).
- If the feed is missing/stale or indicators cannot be calculated, both horizons remain STANDBY.
- No broker orders are ever placed.

## Indicators and independent horizons
Both horizons use EMA(5), EMA(20), RSI(14), and MACD(12,26,9).

NEXT M1 has six checks:
1. EMA5/EMA20 direction.
2. Short-term EMA slope.
3. MACD histogram direction/strengthening.
4. RSI directional range (52–70 bullish; 30–48 bearish).
5. Last completed candle body direction.
6. Live quote momentum from two valid quote observations.

FOLLOWING M1 has its own six checks:
1. EMA5/EMA20 direction.
2. EMA20 slope over multiple observations.
3. MACD histogram direction/strengthening.
4. RSI directional range.
5. Three-candle net movement.
6. Short-term EMA slope.

A direction is emitted only when at least 5 of 6 checks agree and the opposing checks do not materially conflict. Otherwise that horizon is STANDBY. The two horizons are evaluated independently; NEXT M1 is not copied into FOLLOWING M1.

## Meaning of the score
The displayed value (for example, 5/6 or 83/100) is a rule-agreement score only. It is NOT a calibrated probability, historical win rate, confidence interval, or expected return. Do not label it as a win probability.

## Production integration
- `GET /api/live` returns `forecastHorizons.nextCandle` and `forecastHorizons.followingCandle`.
- The Mini App displays both in a compact text readout while retaining its single CALL/PUT/STANDBY signal lamp.
- The existing final-alert schedule and behavior are unchanged: 10-second preparation alert, final result at 5 seconds, all results including STANDBY held for 35 seconds.
- Existing first-horizon dual confirmation remains the source for the final single lamp. The second horizon is informational and separately assessed; it does not create a second alert or order.

## Validation status
The algorithm has been integrated, but predictive accuracy is NOT yet established. Before describing it as accurate, collect a timestamped out-of-sample record, compare each forecast with the actual next candle close-to-close direction, and report separate sample counts, coverage, hit rates, and confidence intervals for each horizon. Include STANDBY coverage and exclude no inconvenient samples. Use chronological walk-forward evaluation; never tune on the final holdout set.

Until those results exist, use the forecast as decision support only and verify against the broker's own price feed. Never promise a particular accuracy percentage.
