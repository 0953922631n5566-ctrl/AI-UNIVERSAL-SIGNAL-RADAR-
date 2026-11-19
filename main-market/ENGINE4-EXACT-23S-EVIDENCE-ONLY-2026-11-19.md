# Engine 4 — exact first-23-second evidence window (2026-11-19)

- Scope: production Main Market branch only; V1, BB, Trend Rider, UI, alert sound/vibration, signal hold, and broker/manual-only behavior remain unchanged.
- Engine 4 uses the forming M1 candle's Twelve Data Streaming OHLC and directional tick changes from the first 23 seconds after candle open. Tick-window membership is classified using the provider event timestamp, not the server's processing clock.
- The decision becomes eligible at 23 seconds and must be dispatched before second 30. It uses open-to-current displacement (40%), tick imbalance (35%), candle body (15%), and close location (10%).
- The current live price is passed explicitly as the decision price.
- Removed the minute-parity and previous-closed-candle direction fallbacks. If the current candle's price/tick evidence is flat or tied with no directional edge, Engine 4 returns NO_DIRECTIONAL_EDGE / STANDBY instead of fabricating CALL/PUT.
- A directional score is heuristic evidence strength, not calibrated probability or a demonstrated win rate.
- Automated broker execution is not part of this project; signals are for manual entry through the Telegram Mini App.
- Tests added/updated for flat evidence. CI, PR review, merge, Render deployment, live timing and Mini App verification remain pending.
