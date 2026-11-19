# Engine 4 — Every M1 candle signal at second 23 (2026-11-19)

- Preserve production `main-market`; implement on `feature/engine4-every-m1-signal-at-23s-20261119`.
- Collect the forming M1 candle OHLC and directional tick counts from second 0 through second 23.
- Wait for the full collection window, then make one weighted CALL/PUT decision at or after second 23, with a hard dispatch deadline before second 30.
- Direction weights: open-to-current displacement 40%, directional tick imbalance 35%, candle body 15%, and close location 10%. JPY pairs use 0.01 pip size; other supported pairs use 0.0001.
- When current-candle evidence ties, use current price direction, tick majority, then the most recent non-doji closed candle as tie-break. If all evidence is flat, minute parity is a final deterministic fallback. This guarantees a binary output on a valid feed but does not create predictive information from a flat market.
- Do not fabricate a signal if the live preview or this candle's tick statistics are missing. Fresh streaming data is a hard requirement.
- One signal per M1 candle; preserve the existing 30-second alert hold, shared sound/vibration, CALL red / PUT green, Mini App delivery, and manual-only broker behavior. V1, BB, and Trend Rider remain independent and unchanged.
- Confidence is a heuristic evidence-strength score, not a calibrated probability or demonstrated win rate. Forward paper-trading/out-of-sample validation is required.
- Pending CI, review, PR merge, Render deployment, and live endpoint/Mini App verification.
