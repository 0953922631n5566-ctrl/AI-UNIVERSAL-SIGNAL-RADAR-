# Early Entry + Counter-Trend Guard — 2026-11-13

## Scope
Main Market only: EUR/USD / Non-OTC / M1. No OTC, OCR, APK, broker execution, or experimental repository changes.

## Changes
- During the existing T-5 finalization window only, permit the fresh live M1 candle as a provisional scoring candle when the stream tick is <=5 seconds old and the candle timestamp is the current minute.
- Keep the 54 fully closed-candle source-quality gate unchanged. REST-only, stale, malformed, or out-of-window live candles are never used as provisional candidates.
- Add a directional run guard: after at least three same-direction candles, do not release a counter-trend direction unless the current opposite candle shows an early micro-turn (body/close-location plus EMA5 slope shift) or CHOCH confirms it.
- Block late continuation when a direction is already extended and exhaustion is HIGH; report auditable risk flags and run metrics.
- Preserve 65 CALL/PUT and 45 PREPARE thresholds, T-10 PREPARE, T-5 finalization, 30-second hold, data-quality checks, and Choppy/ATR kill switches.

## Validation
- Added unit tests for bullish-run counter-trend blocking, early bearish micro-turn, and T-5-only provisional live-candle admission.
- Production deployment must pass Render postinstall tests and syntax checks before being treated as deployed.
- These changes are safeguards, not proof of profitability. Next-M1 observation and out-of-sample evaluation remain necessary.
