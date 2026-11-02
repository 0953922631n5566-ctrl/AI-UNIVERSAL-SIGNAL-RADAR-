# AI Universal Signal Radar — Main Market

Single-market signal dashboard for **EUR/USD, 1-minute candles**.

## Runtime
- Node.js 18.x
- Express 4
- Twelve Data API key supplied through the Render environment variable `TWELVE_DATA_API_KEY`
- Start command: `npm start`

## Render configuration
- Build: `npm install`
- Start: `npm start`
- Environment: `TWELVE_DATA_API_KEY` (set privately in Render; never commit credentials)

## Signal behavior
- Outputs CALL, PUT, or STANDBY.
- Uses EMA(5/20), RSI(14), and a market-regime filter.
- After a CALL/PUT decision, the next newly observed candle is forced to STANDBY (one-candle cooldown).
- Stale data is forced to STANDBY.
- Manual decision support only; no broker orders are placed.

## Important validation notes
The supplied strategy uses the latest Twelve Data bar returned by the API; the API response may include a still-forming minute candle. This implementation does not independently confirm candle closure. The one-candle cooldown is applied per newly observed timestamp by this single-process server. Verify live API access and candle timestamps before relying on signals. This is a rule-based indicator engine, not a trained machine-learning model.
