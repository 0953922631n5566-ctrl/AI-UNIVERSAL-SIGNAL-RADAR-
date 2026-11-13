# MAIN-MARKET-EARLY-ENTRY-T5-V1

Status: USER-ACCEPTED PRODUCTION BASELINE (documentation snapshot)
Scope: Signal Radar PRO / Main Market / EUR/USD / Non-OTC / M1
Branch: `main-market`

## Why this version is preserved
The user reports that the current system is more accurate than before, still has occasional wrong signals, and is sufficiently useful in their own trading observation to continue monitoring. This is a user-reported observation, not an independently measured win rate or profitability claim.

## Preserved implementation baseline
This label refers to the deployed Main Market state recorded in PROJECT-HANDOFF.md under “2026-11-13 — Main Market price-action analyzer enhancement” and “Deployment verification — 2026-11-13”:
- Decision authority: deterministic Local Partial Scoring with price-action evidence.
- Evidence additions: Market Structure BOS/CHOCH, Candle Confirmation (body, wicks, close location), and Momentum Exhaustion.
- These evidence families are blended into existing scoring components; none independently forces CALL or PUT.
- Existing score component budgets: 30/30/20/20; CALL/PUT threshold 65; PREPARE threshold 45.
- Existing Choppy/ATR kill switches remain.
- Closed M1 candle analysis; 100-candle history with 50+4 closed-candle decision window.
- Existing T-10 PREPARE, T-5 finalization, and 30-second signal hold remain.
- Twelve Data stream/freshness safeguards and Telegram Mini App/manual-only operation remain.

## Production provenance recorded in handoff
- PR: #118
- Merge commit: `a333a1dd4a33e70ddb5e2418c17927d0fc57363e`
- Render deploy: `dep-dbrffrnf3r2c73c00dn0`
- Handoff records Render deploy status as live and the streaming subscription as accepted at verification time.

## Rules for future tuning
1. Treat this snapshot as the comparison baseline; do not silently replace or overwrite it.
2. Record each CALL/PUT against its exact target M1 candle before judging the outcome.
3. Separate WIN, LOSS, FLAT/DOJI, and UNKNOWN; do not infer broker fills or realized P&L from candle direction alone.
4. Compare candidate changes chronologically against this baseline, including trend, range, volatility, and reversal conditions.
5. Do not change production scoring thresholds or timing based on a small sample. Require documented tests and user approval before strategy changes/deployment.
6. Keep experiments isolated from `main-market`; preserve a rollback path.
7. No claim of validated accuracy, positive expectancy, or profitability until sufficient out-of-sample/paper-trading evidence exists.

This file is a durable version record. It does not change analyzer behavior.
