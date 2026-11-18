# Main Market — 1-second live analysis update (2026-11-18)

- Changed local analyzer cadence from 2 seconds to 1 second for V1, BB Pure Scalper, Trend Rider, and Engine 4.
- Reuses the existing Twelve Data WebSocket tick buffer and provisional M1 candle; no per-second REST polling was added.
- REST history refresh remains 180 seconds; WebSocket stale-feed watchdog remains 5 seconds.
- Preserved M1 timeframe, 50 context + 4 entry candle window, T-10 PREPARE, T-5 CALL/PUT finalization, and 30-second signal hold.
- Evaluation remains single-flight via evaluationBusy so a slow pass cannot overlap another pass.
- Forward-test only: faster refresh may reduce reaction latency but does not establish higher signal accuracy or profitability.
