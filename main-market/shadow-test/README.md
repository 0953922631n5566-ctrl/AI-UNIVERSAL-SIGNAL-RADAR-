# Isolated 5-minute EUR/USD M1 one-win shadow test

This service is isolated from the production signal decision path. It polls the read-only Main Market EUR/USD M1 public endpoint every two seconds and evaluates five existing filters plus one primary consensus strategy.

The primary candidate, `CONSENSUS_3_OF_4`, is emitted only when at least three of these four filters agree on CALL or PUT: EMA5 flow, EMA5/EMA20/ADX trend, RSI/Bollinger momentum, and EMA5 fast momentum. It does not force a direction when the filters disagree. The live system signal is tracked only as a separate baseline.

The experiment observes for five minutes, then waits up to one additional M1 candle boundary to settle an already-open shadow prediction. The stated target is achieved only if the consensus strategy records at least one actual WIN. No result is guaranteed. It does not send orders, alter production signals, change production thresholds, or access broker accounts.

## Run locally

From `main-market/`:

```bash
MARKET_SOURCE_URL=https://ai-signal-radar-main-market.onrender.com/api/public/signal node shadow-test/server.js
```

- `GET /health` reports source connectivity and progress.
- `GET /results` returns the complete report after settlement.

## Scoring rules

A candidate is generated from a fully sampled, completed source M1 candle. Its simulated entry is the first observed live tick in the following M1 minute, and its exit is the final sampled price of that target minute. CALL wins only when exit is above entry; PUT wins only when exit is below entry; equal prices are FLAT. Incomplete or stale candles are skipped, not scored.

This is a short screening experiment, not proof of a durable edge. The first observed tick is a proxy for the candle open, and results exclude broker spreads, payout, latency, and execution slippage. A five-minute sample may produce no consensus trade; that is reported as no result rather than manufacturing a win.
