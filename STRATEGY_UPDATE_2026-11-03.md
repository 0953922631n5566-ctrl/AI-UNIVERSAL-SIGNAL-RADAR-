# Strategy update — EMA5/EMA20 + RSI14 confirmation

Date: 2026-11-03
Project: AI Universal Signal Radar — Main Market / NON-OTC
Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
Branch: feat/ema-rsi-trend-confirmation
Pull request: #17

## User-approved change
The user approved applying the supplied EMA5/EMA20 and RSI14 concepts to the existing multi-regime engine. This is an additive strategy refinement, not a clean-slate replacement.

## Changes in this branch
- EMA uses the standard SMA seed from the first N observations, then recursive smoothing.
- RSI14 uses Wilder smoothing instead of a simple average of the latest 14 price changes.
- TREND CALL requires EMA5 > EMA20, live price >= EMA5, and RSI14 >= 50.
- TREND PUT requires EMA5 < EMA20, live price <= EMA5, and RSI14 <= 50.
- BREAKOUT CALL/PUT must also agree with EMA trend and RSI momentum. A breakout without that agreement returns WAIT/STANDBY rather than entering against the prevailing trend.
- SIDEWAY remains a limited exception: CALL only near the 20-candle support edge with RSI14 <= 45; PUT only near resistance with RSI14 >= 55. Otherwise WAIT/STANDBY.
- No synthetic prices, demo signals, fixed-price fallbacks, or automatic broker orders.

## Preserved production behavior
- Real Twelve Data EUR/USD history and real WebSocket quote ticks.
- Market: NON-OTC; timeframe: M1.
- Preparation alert: 10 seconds before minute rollover.
- Final result window: final 5 seconds of the M1 candle.
- Result hold: 35 seconds.
- Manual entry only; no automatic broker execution.
- The existing main branch and production service are not modified by this feature branch before PR merge.

## Files changed
- forecast-engine.js
- test/forecast-engine.test.js

## Verification status
- GitHub Actions run: 41630630422 (Node Forecast Tests), initially observed in progress.
- Do not merge or deploy until the workflow reports success.
- After merge, verify Render deploy is LIVE and inspect /health, /api/config, /api/signal, and /api/live.
- A passing CI run does not prove that a live CALL/PUT occurs in market conditions or that Xiaomi 11T sound/vibration works.
- Telegram Mini App launch and physical-device sound/vibration still require user-side testing.

## Rollback
If this strategy refinement causes unexpected behavior, revert the PR merge commit. The previous production logic is preserved on main until the PR is merged.
