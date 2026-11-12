# M5 LIVE DIRECTION + M1 PRECISION ENTRY — 2026-11-12

## Production change proposal
- New sole directional analyzer: `src/m5-live-m1-entry.js`.
- Live M5 direction is aggregated from the current forming M5 block using the existing Twelve Data M1 REST history plus the current M1 candle updated by Twelve Data Streaming ticks.
- M1 entry requires EMA5 pullback, a live breakout beyond the previous closed M1 high/low, and extension no greater than 1.4 ATR.
- Require at least 30 closed M1 candles and a current live M1 candle.
- Reject missing/stale Streaming ticks; no REST-only signal fallback.
- Enforce one finalized signal per M5 block.
- Existing Telegram Mini App session/authentication, Twelve Data pool, pair selector, T-10/T-5 timing, 30-second hold, sound and vibration are preserved.
- Legacy M1 analyzer source remains in the repository for rollback but is removed from the active production decision path in this branch.
- No synthetic-price runtime, simulation, replay, broker execution, or external AI call is used.

## Validation
- Unit tests cover M5 candle aggregation, live tick freshness, current-live-candle requirement, one-signal-per-M5-block and live-provider metadata.
- GitHub Actions CI and live Twelve Data forward verification are required before merge/deploy.
- `signalReleaseValidated` remains false: this strategy has not been proven by out-of-sample testing and does not guarantee outcomes.
