# Level 1 Strict False-Signal Filter — 2026-11-12

- Added `src/false-signal-filter.js` after Original84 Partial Scoring and before analyzer output is published.
- Level 1 live-blocking rules:
  - Strong opposing wick rejection: opposing wick >= 68% of candle range and body <= 32%.
  - Failed breakout: price pierces the recent 7-candle boundary, closes back inside, and rejection wick >= 35%.
  - Stacked momentum conflict: candle body/close momentum, EMA5 slope, and DMI all oppose the candidate direction.
- A blocked candidate is changed to STANDBY, its prepare direction is cleared, and auditable reason codes are attached in `falseSignalFilter` and `riskFlags`.
- Original84 scores, thresholds, market data, timing, Twelve Data pool, Telegram Mini App assets, and UI were not changed.
- Added unit tests for CALL/PUT wick rejection, stacked momentum conflict, and clean/non-directional pass-through.
- Level 1 is the active production filter; Level 2 is not enabled.
- Build/test and Render deployment must be verified separately. This is a conservative heuristic gate, not proof of predictive accuracy.
