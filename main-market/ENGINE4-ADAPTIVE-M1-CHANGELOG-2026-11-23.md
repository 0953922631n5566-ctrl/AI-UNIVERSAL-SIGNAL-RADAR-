# Engine 4 — Twelve Data Adaptive M1 Scalper (2026-11-23)

- Rebuild Engine 4 strategy only; Engines 1–3 and their timing/alerts remain unchanged.
- Inputs: Twelve Data closed M1 OHLC history, Twelve Data EMA(5) endpoint, and live Twelve Data Streaming price.
- Derived locally from the same OHLC: EMA(8/21), RSI(7), MACD(5,13,4), ADX(14), ATR(14), and Bollinger Bands(20,2). This avoids separate REST calls for each indicator and keeps inputs synchronized.
- Adaptive regimes: Trend (ADX >= 14) uses EMA alignment, provider EMA5 slope, MACD/RSI confirmation, pullback reclaim/rejection or breakout/breakdown. Range (ADX < 14) only trades outer Bollinger rejection with RSI confirmation. Transition and abnormal volatility are blocked.
- Trigger on live tick confirmation as soon as a setup appears; target the current M1 candle; one Engine 4 signal per candle; preserve the existing 30-second hold and shared Mini App alert pipeline.
- No score, no broker execution, no changes to Engines 1–3. This is a new heuristic requiring forward paper-trading validation; no win-rate guarantee is implied.
- API usage: one provider EMA5 request per M1 plus existing REST candle sync and Streaming subscription. Other indicators are derived from the same Twelve Data OHLC.
