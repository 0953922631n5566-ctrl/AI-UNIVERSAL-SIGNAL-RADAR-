# Main Market Accuracy V2 — 2026-11-11

Scope: analyzer-only update on `main-market`.

## Changes
- Preserve the deterministic Partial Scoring engine, 50 context + 4 entry closed M1 candles, 65 CALL/PUT threshold and 45 PREPARE threshold.
- Add a 10-candle efficiency-ratio chop detector alongside the existing EMA-tangle/flat-slope and ATR-spike guards.
- Add an ADX14-style trend-strength diagnostic; it is used with low efficiency to identify weak directional movement, not as a standalone direction signal.
- Score the latest candle's close location, body direction and distance from EMA5; subtract an entry-quality penalty from each side's score.
- Suppress directional/PREPARE output when CALL/PUT scores are separated by fewer than 8 points or the candidate is more than 1.65 ATR from EMA5.
- Expose the additional regime and entry-quality diagnostics in the existing analyzer result.

## Unchanged
- No edits to `server.js`, `public/**`, Telegram Mini App UI/auth/session, WebSocket/Streaming, Twelve Data pool, timing/release gates, database, or broker execution.
- No Gemini calls or new external dependencies.
- Existing score weights and 65/45 thresholds remain unchanged.

## Validation
- Added regression tests for diagnostics, compressed chop, late-entry suppression and CALL/PUT symmetry.
- Passing CI and live deployment verification are required before describing this change as production-ready.
- This is a rule-based filter improvement, not proof of predictive accuracy or profitability. Backtest, out-of-sample and paper-trading validation remain necessary.

- Test contract updated to assert the two additional guard thresholds (`minDirectionalGap=8`, `maxEntryExtensionAtr=1.65`).
