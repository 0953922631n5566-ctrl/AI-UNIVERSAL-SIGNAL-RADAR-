# Future Simulation Engine — Experimental Design

Branch: `feature/future-simulation-engine`
Base: `d260d68368a91f07eb9ab65f2e305bb02f08a143`

## Purpose
Provide a separate what-if projection for the next 10, 20 and 30 seconds using recent closed-candle ATR, volatility expansion and directional momentum. It estimates a range envelope and heuristic reversal/fakeout risk; it does not claim to know future prices.

## Modules
- `simulation/future-simulation-engine.js`: pure calculation only; no network, timers, server imports or mutable shared state.
- `simulation/simulation-safety-gate.js`: pure adapter that can downgrade CALL/PUT to STANDBY when simulation is unavailable or reversal risk exceeds a configurable threshold.
- `simulation/index.js`: public module exports.
- `tests/future-simulation.test.js`: deterministic unit tests.

## Integration contract
- The existing Decision Engine remains unchanged.
- The simulator is not wired into `server.js`, `analyze-market.js`, or the live Render service in this initial scaffold.
- A later integration should run only after the original Decision Engine produces CALL/PUT, reuse already-fetched candles/indicators, and impose a strict compute budget. No extra Twelve Data request is allowed.
- Enable the gate only after replay/backtest calibration. Until then it is experimental and must not change live signals.


## Offline replay harness

- Run: `npm run backtest:m1 -- ./data/EURUSD_M1.csv ./backtest-report.json`.
- Input supports ascending UTC-header CSV (`time,open,high,low,close`) and HistData Generic ASCII (`YYYYMMDD HHMMSS;open;high;low;close;volume`). HistData's documented fixed EST (UTC-5, no DST) timestamps are converted to UTC during import; at least 202 valid candles are required.
- Public source candidate: [HistData EUR/USD Generic ASCII M1 downloads](https://www.histdata.com/download-free-forex-data/). The 2025 archive selection page was inspected, but the download uses a JavaScript action and no ZIP download confirmation was available in the browser session; no dataset has yet been imported or backtested.
- The replay calls the existing analyzer using only candles available up to each decision point, then scores the next contiguous M1 candle from its open using favorable/adverse range. Weekend/session gaps are excluded.
- Threshold grid: 0.55, 0.60, 0.65, 0.70, 0.72, 0.75, 0.80. The report includes fakeout capture and good-signal loss; no threshold is auto-selected.
- This is a coarse M1 diagnostic, not validation of the 10/20/30-second envelopes. Exact sub-minute calibration requires timestamped tick/second-level EUR/USD data. Use separate in-sample and out-of-sample date ranges before proposing any production threshold.
- No historical dataset has been bundled, and no live Twelve Data key or production endpoint is read by this script.

## Safety and limitations
- Projection horizons are 10/20/30 seconds within an M1 candle.
- ATR and momentum create scenario envelopes, not deterministic candle shapes.
- Reversal risk is a heuristic score, not a statistically calibrated probability.
- Before production use: validate against timestamped historical EUR/USD data, measure false blocks and missed fakeouts, tune thresholds out-of-sample, and verify added latency.
- Any missing or invalid simulation output must fail closed only when the feature is explicitly enabled; with the feature disabled, legacy behavior is unchanged.
