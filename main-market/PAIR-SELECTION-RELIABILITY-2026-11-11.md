# Main Market pair-selection reliability — 2026-11-11

## Scope
- Main Market Telegram Mini App only.
- Preserve the existing six configured Non-OTC M1 pairs: AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- One selected pair at a time; do not subscribe to all six concurrently.
- Do not modify the analyzer, score weights, thresholds, kill switches, candle window, signal timing, authentication, Telegram session, or Mini App layout.

## Pair-feed changes
- Selecting a pair now forces a REST history sync for that exact pair even when monitoring is currently stopped.
- When monitoring is active, the new pair's WebSocket stream is started only after its REST history sync finishes.
- The selected pair's public snapshot now exposes a fresh Streaming tick when available, otherwise the latest closed REST candle close as the displayed price.
- A REST fallback price is display/data context only. Directional signal release still requires the existing fresh Streaming tick and existing timing/data guards.

## Verification
- Added tests for the unconditional selected-pair REST sync, REST-price display fallback, and REST request construction for all six configured symbols.
- These tests do not prove the user's Twelve Data account has WebSocket entitlement for every pair. Actual per-pair REST/Streaming acceptance must be confirmed against the live account after the change is deployed.
