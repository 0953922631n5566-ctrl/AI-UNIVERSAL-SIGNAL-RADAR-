# Engine 4 — Strict Trend Rider Copy

- Replaced the previous every-candle directional blend with an isolated copy of Engine 3 (Trend Rider AI) in `src/engine-four.js`.
- Engine 3 source and its UI card remain unchanged.
- Strict settings: 35 valid closed M1 candles, score >= 75, directional score margin >= 18, sideways EMA gap guard 0.18 ATR, late-extension guard 1.25 ATR, abnormal candle range guard 2.3 ATR, and candle-body momentum >= 0.45.
- Requires EMA5/EMA20 alignment and slope, supporting recent structure, a pullback reclaim or structure breakout, and same-direction momentum.
- Engine 4 remains independent and does not enter the aggregate V1/BB/Trend Rider pipeline.
- Engine 4 card colors swapped: CALL green, PUT red. No change to other cards.
- Uses existing Telegram Mini App, T-10 watch / T-5 confirmation / 30-second hold UI flow.
- Test coverage updated for strict directional confirmation, sideways blocking, data validity and target timing.
