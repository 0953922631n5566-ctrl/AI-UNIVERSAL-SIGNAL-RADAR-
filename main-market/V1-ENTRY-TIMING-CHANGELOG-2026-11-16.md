# V1 Entry Timing Quality Guard

Date: 2026-11-16
Branch: feature/v1-entry-timing-quality-20261116
Scope: V1 Partial Scoring only. BB Pure Scalper remains fully independent.

## Why
V1 already blends BOS/CHOCH, candle confirmation and momentum exhaustion into its four existing score components. Those features were supporting evidence only, so a high aggregate score could still release a late continuation entry after price had stretched away from EMA5.

## Change
- Add a V1-only entry timing assessment after direction scoring.
- Keep the four component weights (30/30/20/20), CALL/PUT threshold (65), PREPARE threshold (45), and direction scoring unchanged.
- When price is at least 1.25 ATR beyond EMA5 and the same-direction run / exhaustion evidence indicates a mature move, hold V1 at PREPARE with an explicit wait-for-pullback reason.
- An extreme extension of at least 1.8 ATR with a same-direction run of at least two candles also waits for pullback.
- A normal EMA5 pullback or a fresh reversal remains eligible; the guard is not a blanket EMA-distance veto.
- Add auditable entry timing diagnostics and a dedicated risk flag.
- BB signal generation, BB score, BB timing, Twelve Data, shared source-quality gate, T-10/T-5 timing, 30-second hold, sound/vibration and Mini App layout are not changed.

## Validation
- Added deterministic tests for late continuation, fresh pullback, opposite-direction move, invalid data, and V1 signal-release suppression.
- CI / Render build / live endpoint / Telegram Android device checks must be completed before calling the change deployed or tested end-to-end.
- This is an entry-quality hypothesis, not proof of higher win rate. Continue demo/paper testing and record outcomes before any further threshold calibration.
