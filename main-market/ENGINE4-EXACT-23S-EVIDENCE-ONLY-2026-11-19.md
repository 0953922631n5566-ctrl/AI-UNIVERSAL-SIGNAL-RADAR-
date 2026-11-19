# Engine 4 — exact first-23-second evidence window (2026-11-19)

- Scope: production Main Market branch only; V1, BB, Trend Rider, UI, alert sound/vibration, signal hold, and broker/manual-only behavior remain unchanged.
- Engine 4 uses the forming M1 candle's Twelve Data Streaming OHLC and directional tick changes from the first 23 seconds after candle open. Tick-window membership is classified using the provider event timestamp, not the server's processing clock.
- The decision becomes eligible at 23 seconds and must be dispatched before second 30. It uses open-to-current displacement (40%), tick imbalance (35%), candle body (15%), and close location (10%).
- The current live price is passed explicitly as the decision price.
- Removed the minute-parity and previous-closed-candle direction fallbacks. If the current candle's price/tick evidence is flat or tied with no directional edge, Engine 4 returns NO_DIRECTIONAL_EDGE / STANDBY instead of fabricating CALL/PUT.
- A directional score is heuristic evidence strength, not calibrated probability or a demonstrated win rate.
- Automated broker execution is not part of this project; signals are for manual entry through the Telegram Mini App.
- Targeted Engine 4 tests: 10/10 passed. Render full suite: 196 tests, 192 passed, 0 failed (4 skipped); JavaScript syntax checks and build succeeded.
- PR #181 and PR #182 merged to `main-market`. Render deploy `dep-dbvas3ui0phs73cg6n5g` is live; `/health` reports version `2026-11-19-engine4-first23s-evidence-only-v2`.
- Live log verification recorded Engine 4 signal finalization at 2026-11-19T08:07:23.204Z, about 23.2 seconds after candle open, with Mini App polling availability at 08:07:23.205Z. This is one live example, not proof of every-candle delivery or predictive accuracy.
- Continue observing consecutive M1 candles and recording outcomes. No broker order is executed.
