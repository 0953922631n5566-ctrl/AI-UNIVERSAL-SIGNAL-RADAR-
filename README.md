# AI Universal Signal Radar

MAIN MARKET only — EUR/USD, M1. Node.js 20+ service with a five-layer deterministic analysis engine and mobile Mini App.

## Run

1. Set `TWELVE_DATA_API_KEY` in the environment.
2. Run `npm install` (no external dependencies) and `npm start`.
3. Open `/`; health endpoint is `/api/health`.

## Environment

- `TWELVE_DATA_API_KEY` — required, server-side only.
- `DATA_REFRESH_MS` — default 125000 ms (about 691 REST requests/day while continuously scanning).
- `MAX_CANDLE_AGE_MS` — default 180000.
- `MIN_SIGNAL_SCORE` — default 68.

The service only evaluates closed candles. It fails safe to STANDBY on missing keys, stale data, provider errors, or insufficient history. The first five candles are the minimum data-ingest threshold; EMA50/RSI14/MACD/ADX require longer history before a directional signal is eligible. No automatic broker orders are sent.

REST polling at a quota-safe 125 seconds cannot guarantee tick-level 10s/3s pre-close alerts or one decision per minute. The browser countdown and local alerts are clock-based; provider refreshes remain limited by the configured API quota. Signals are held for 40 seconds.
