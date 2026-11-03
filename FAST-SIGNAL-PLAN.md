# Fast Signal A — EUR/USD M1 (Experimental Only)

## Safety / deployment
- This branch is isolated from `main`; production Render remains on `main`.
- No broker order-placement code exists in this experiment.
- Do not merge or enable live alerts until a real historical backtest and paper-forward test pass.
- Signals are evaluated from completed candles only. A signal is not a guaranteed direction or a probability.

## Design
Fast directional score per completed M1 candle:
- EMA(3) vs EMA(8): 20 points
- Close vs EMA(3): 10 points
- RSI(5) momentum zone: 15 points (CALL 52–<78; PUT >22–48)
- 3-candle momentum normalized by ATR(14): 20 points (threshold ±0.08 ATR)
- MACD histogram (5,13,4): 15 points
- Latest candle body direction, body >= 25% of range: 10 points
- Close vs previous close: 10 points

Emit CALL or PUT at score >=55 and directional score edge >=15; otherwise STANDBY.
Scores are rule scores, not calibrated probabilities. The rules intentionally allow a signal on each new closed candle, so maximum practical cadence on M1 bars is one evaluation per minute, not multiple independent trades within a minute.

## Backtest protocol
`backtestFastSignal(candles)`:
- calculates the signal using candles through candle i only;
- assumes entry at candle i+1 open;
- evaluates direction at candle i+1 close;
- reports wins/losses/flats and both win-rate conventions;
- does not model spread, slippage, broker payout, execution delay, or OTC prices.

This is a screening backtest only. Before judging performance, run against a clean, timestamped EUR/USD M1 OHLC dataset covering multiple market regimes and sessions, then include realistic spread/slippage and compare to a baseline. Do not tune on the final holdout period.

## Current data-feed limitation
Production currently uses Twelve Data REST 1-minute candles with a 120-second refresh cache. That feed cannot support second-by-second signal refresh or a reliable new M1 signal every minute. Twelve Data documents real-time tick streaming over WebSocket, but full WebSocket access for all symbols is plan-dependent; lower tiers may only test permitted trial symbols. Confirm EUR/USD entitlement and current plan before relying on it.

## Run tests
```sh
node --test experimental/fast-signal.test.js
```

## Run a real-data backtest
Export chronological OHLC CSV with columns `datetime,open,high,low,close`, then pass parsed candle objects to `backtestFastSignal`. Keep the dataset separate from the production service. Record sample size, dates, spread assumptions, signal count, win rate, and results by session/regime.
