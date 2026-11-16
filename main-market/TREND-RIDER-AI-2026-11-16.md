# Trend Rider AI — 2026-11-16

## Scope
- Added Trend Rider AI as an independent third Main Market analyzer beside V1 and BB Pure Scalper.
- EUR/USD M1 Mini App remains manual-only; no broker execution, chat messages, APK work, OTC, or OCR changes.
- V1 and BB analyzer source/formulas were not modified.

## Trend Rider logic
- Closed M1 OHLC candles only; requires at least 30 valid closed candles.
- EMA5/EMA20 alignment and slope, recent swing structure, pullback reclaim or local structure breakout, and candle momentum.
- Directional score threshold: 65/100, with at least a 12-point separation between CALL and PUT scores.
- Guards: EMA compression/sideways, extension beyond 1.5 ATR from EMA5, and latest candle range above 2.8 ATR.
- Emits its own TREND_RIDER candidate and active signal state; does not read V1/BB scores or outcomes.

## Signal lifecycle
- Uses shared source-quality checks and existing T-5 finalization / 30-second hold.
- Has independent per-engine deduplication and dispatch state.
- Public output includes engineResults.TREND_RIDER and trendRider diagnostics.
- Mini App third card now displays the live signal, status, and reason instead of a disconnected placeholder.

## Validation
- Added tests for insufficient/malformed data, rising CALL, falling PUT, sideways blocking, and independence from V1/BB inputs.
- This strategy has not yet been validated out-of-sample; a passing unit test is not a live accuracy claim.
