# Accuracy Lab — Full Market Intelligence

- Branch: `accuracy-lab/reversal-radar-original-84-20261111`
- Production target: existing `main-market` service, using its current connection and notification path.
- Signal authority: `src/accuracy-lab/market-intelligence.js` is the sole CALL/PUT directional analyzer after integration.
- ORIGINAL 84 / former analyzer is not called to calculate, vote on, or combine the directional signal.
- `sourceGate` is retained only for candle quality, history sufficiency, freshness, and permitted REST fallback; it does not decide direction.
- Existing Twelve Data REST + Streaming, API key pool, Telegram Mini App authentication/session, polling, T-10 PREPARE, T-5 CALL/PUT finalization, fresh-tick check, 30-second signal hold, and sound/vibration UI are preserved.
- The separate Reversal Radar panel remains diagnostic only and is not part of the CALL/PUT decision.
- Accuracy Lab classifies trend, sideway risk, volatility, candle structure, reversal, pullback, continuation, false breakout, breakout/retest candidates.
- Sideway, high-volatility, and transition regimes are guarded. When no valid setup exists, the engine returns STANDBY.
- This is a deterministic prototype, not a proven profitable strategy. No win-rate guarantee is made. Historical replay, out-of-sample evaluation, and forward paper testing remain necessary before relying on performance claims.
- No broker order execution is implemented.
