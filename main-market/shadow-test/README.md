# Isolated 10-minute live shadow test

This service is deliberately separate from the production signal decision path. It polls the read-only public Main Market EUR/USD M1 endpoint every two seconds and evaluates five candidate signal rules:

- EMA5 flow
- EMA5 + EMA20 + ADX trend
- RSI + Bollinger momentum
- EMA5 fast momentum
- The live Main Market signal as a baseline

The test starts automatically when this service boots and observes for 10 minutes. It waits up to one additional M1 candle boundary to settle any already-open shadow predictions. It does not send orders, alter production signals, change thresholds, or access broker accounts.

## Run locally

From `main-market/`:

```bash
MARKET_SOURCE_URL=https://ai-signal-radar-main-market.onrender.com/api/public/signal node shadow-test/server.js
```

- `GET /health` reports source connectivity and progress.
- `GET /results` returns the complete report after settlement.

## Result rules

A candidate is generated from a completed source M1 candle. Its simulated entry is the first observed live tick in the following M1 minute, and its exit is the final sampled price of that target minute. CALL wins only when exit is above entry; PUT wins only when exit is below entry; equal prices are FLAT. Incomplete or stale candles are skipped, not scored.

This is a short screening experiment, not proof of a durable edge. The first observed tick is a proxy for the candle open, and results do not include broker spreads, payout, latency, or execution slippage. No strategy is considered successful unless the observed result actually meets the stated streak target.
