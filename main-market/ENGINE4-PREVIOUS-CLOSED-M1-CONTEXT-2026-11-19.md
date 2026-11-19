# Engine 4 — previous closed M1 candle context (2026-11-19)

- Scope: production Main Market branch only; EUR/USD M1 NON-OTC.
- Engine 4 continues to decide direction only from the current forming M1 candle's first 23 seconds: price displacement 40%, tick imbalance 35%, body 15%, close location 10%.
- The immediately preceding, fully closed and adjacent M1 candle is passed as context. Its body and close location produce a context score that can adjust heuristic evidence strength by up to ±10 points.
- Aligned prior context raises the evidence score; conflicting context lowers it. The previous candle cannot reverse CALL/PUT direction and cannot create a signal when current-candle evidence has no directional edge.
- Invalid, stale, non-adjacent or still-forming prior candles are ignored.
- No V1, BB, Trend Rider, Mini App UI, Twelve Data polling, sound/vibration, signal timing/hold, broker or other project behavior is changed.
- Score is evidence strength, not a calibrated probability or proven win rate. Paper/out-of-sample validation is required.
