# V1 Reversal and Entry-Quality Guard

Date: 2026-11-16
Branch: feature/v1-reversal-entry-guard-20261116
Scope: V1 Partial Scoring only. BB Pure Scalper is not modified.

## Findings addressed
- S/R Fakeout previously received partial points without a confirmed sweep and close reclaim.
- Missing BOS/CHOCH previously received a neutral structure score, adding points without structural evidence.
- Entry timing only guarded large EMA5 extensions, so a mature/fading run or a signal close to the opposing swing could still pass.

## Changes
- S/R Fakeout now awards its 30-point component only for a genuine sweep and close reclaim with a rejection wick; otherwise it awards zero.
- BOS/CHOCH contributes structural points only when a real closed-candle swing break is present; no-event structure contributes zero.
- Added V1-only entry-quality veto for CALL close to recent swing resistance and PUT close to recent swing support unless the candle closes decisively beyond that swing.
- Added a mature-run exhaustion veto when a continuation run has at least three same-direction candles and shows body contraction or meaningful opposing wick rejection.
- The guard holds V1 at PREPARE/WAIT_FOR_CONFIRMATION; it does not change score weights or CALL/PUT/PREPARE thresholds.
- Strong-pressure early entry cannot bypass the new V1 guard.
- BB engine, API pool, Mini App UI, Telegram timing/hold, sound and vibration remain untouched.

## Validation
- Deterministic tests cover both swing-side vetoes, mature-run contraction, confirmed breakout allowance, and fail-closed input handling.
- Full CI and Render deployment must pass before the new logic is considered live. This is a hypothesis to reduce late/reversal entries, not a proven win-rate improvement.
