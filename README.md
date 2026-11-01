# AI UNIVERSAL SIGNAL RADAR — MAIN MARKET

This branch is an isolated Twelve Data / EUR/USD Telegram Mini App. The Android/OCR project on `main` is preserved unchanged.

- EUR/USD only, Non-OTC, 1-minute candles.
- Twelve Data REST history plus optional live price WebSocket.
- Situation-aware regimes: trend, range, high volatility, reversal, unclear.
- Evidence: EMA, RSI, MACD, price action, support/resistance and volatility.
- CALL / PUT / STANDBY only. No broker order execution and no Telegram chat messages.
- Start/stop monitoring in Mini App; stream closes when final Mini App client disconnects.

Render: branch `main-market`, build `cd main-market && npm install`, start `cd main-market && npm start`, Singapore, Free plan. Set `TWELVE_DATA_API_KEY` only as a Render environment secret.

Twelve Data Basic currently lists 8 API credits/minute and 800/day; one `/time_series` symbol costs 1 credit. 120-second resync is approximately 720 requests/day when continuously active. WebSocket access must be verified for the account; REST fallback is used and stale data forces STANDBY.

The decision logic is a transparent heuristic, not a trained model or proven profitable strategy. Validate on historical and paper data before relying on signals.
