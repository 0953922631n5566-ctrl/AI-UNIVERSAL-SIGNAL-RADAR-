# V1 Strong Buying / Selling Pressure Early Entry

Date: 2026-11-16
Scope: V1 Partial Scoring only. BB Pure Scalper remains independent and unchanged.

## Change
- Add a closed-candle OHLC pressure detector for strong buying and selling pressure.
- Pressure is a price-action proxy (body size, directional close location, body/ATR); it is not actual traded volume or exchange order flow.
- Permit an early V1 CALL/PUT from score 58 only when the pressure detector is strong, direction score gap is at least 8, and the existing choppy-market, abnormal-ATR, and late-extension guards all pass.
- Strong pressure requires a directional candle body ratio >=0.62, close location >=0.78 toward the candle extreme, body >=0.55 ATR, pressure score >=0.74, and EMA slope/price or BOS/CHOCH alignment.
- Existing normal signal threshold remains 65; PREPARE remains 45. Strong-pressure fast lane is a narrow conditional path, not a global score reduction.
- The existing late-entry wait-for-pullback guard is not bypassed.
- Shared source-quality gate, T-10/T-5 timing, 30-second hold, sound/vibration, API pool, Mini App layout, and BB engine are unchanged.

## Validation
- Added tests for bullish and bearish strong pressure, long-wick indecision, counter-direction rejection, missing data, conditional early-entry threshold, ambiguous direction, and risk vetoes.
- CI must pass before merge. Then verify Render health, public signal payload, and Telegram Mini App display.
- This is a faster-entry hypothesis, not a claim of improved accuracy. Demo/paper testing remains necessary.
