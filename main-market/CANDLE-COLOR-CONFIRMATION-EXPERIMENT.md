# ORIGINAL 84 — Candle Color & Momentum Experiment

Status: isolated experiment; ORIGINAL 84 remains the immutable rollback baseline.

- Base commit: `18853e9f529254e9be5f7d4d8328543a7833e99d`
- Branch: `experiment/original-84-candle-confirmation-20261113`
- Scope: add only Candle Color & Momentum Confirmation to the existing Partial Scoring decision path.
- Inputs: closed M1 OHLC candles already supplied by Twelve Data; no image capture or OCR.
- Observation window: latest 3 closed candles.
- Color: GREEN when close > open; RED when close < open; DOJI when body/range <= 8%.
- Confirmation: at least 2 of 3 candles align with the candidate direction, the latest candle aligns (or is a strong directional Doji), directional body momentum >= 0.12 of summed candle ranges, and latest close-location >= 0.55.
- Effect: only a final CALL/PUT candidate (base score >= 65) that fails confirmation is downgraded to PREPARE. Original score, component weights (30/30/20/20), thresholds (65/45), kill switches, source/data guards, timing, API pool, and Mini App code remain unchanged.
- PREPARE and STANDBY are not changed by this add-on.
- Rollback: redeploy ORIGINAL 84 commit/tree; do not merge this experiment into `main-market` until forward-test results are reviewed and explicitly approved.
- Validation caveat: passing unit tests and live health checks do not establish trading profitability or an out-of-sample win rate.
