# Strategy update — EMA5/EMA20 + RSI14 confirmation

Date: 2026-11-03
Project: AI Universal Signal Radar — Main Market / NON-OTC
Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
Pull request: #17 (merged)
Merge commit: bbf1f1b394d1800a89b446e26551ad4ed3f162eb

## User-approved change
The user approved applying the supplied EMA5/EMA20 and RSI14 concepts to the existing multi-regime engine. This is an additive strategy refinement, not a clean-slate replacement.

## Strategy now deployed
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

## Files changed
- forecast-engine.js
- test/forecast-engine.test.js
- STRATEGY_UPDATE_2026-11-03.md

## Automated verification
- GitHub Actions Node Forecast Tests run 41630630422: SUCCESS.
- npm test completed successfully on the feature branch before merge.

## Production deployment verification
- PR #17 merged successfully.
- Merge/deploy commit: bbf1f1b394d1800a89b446e26551ad4ed3f162eb
- Render service: ai-universal-signal-radar-main (srv-dbkaoo0473hc7384tmog).
- Render deploy: dep-dbkskvflk1mc73e8jjn0 — status LIVE.
- /health: status ok; strategy MULTI_REGIME_M1; finalAlertWindowSeconds=5; signalHoldSeconds=35; historyCandles=200; liveStream=subscribed.
- /api/config: EUR/USD NON-OTC M1; TREND/SIDEWAY/BREAKOUT; preparation=10s; final window=5s; hold=35s; manualOnly=true; automaticBrokerOrders=false.
- /api/signal: Twelve Data apiStatus=connected; DATA_ONLY; 200 real closed candles. REST remains history/freshness only.
- /api/live: WebSocket subscribed and live EUR/USD quote received. The sampled live state was SIDEWAY / WAIT with EMA5 below EMA20 and RSI14=42.4; STANDBY was the correct outcome because the sideway edge/rejection conditions were not confirmed.
- These endpoint checks verify deployment and live data/indicator processing. They do not prove that a CALL/PUT will occur in a specific market state.

## Still requires physical-device verification
- Telegram Mini App launch through the bot menu.
- Actual sound and vibration on Xiaomi 11T / Android 14.
- Observe a real CALL/PUT during the final five-second window and verify the 35-second hold on the phone.
- A passing CI run and LIVE Render deploy do not establish profitability or guarantee signal accuracy.

## Rollback
If this strategy refinement causes unexpected behavior, revert merge commit bbf1f1b394d1800a89b446e26551ad4ed3f162eb.

## Final Mini App timing-label consistency fix
- Corrected the client-side explanatory text from "final 3 seconds" to "final 5 seconds" so the display agrees with the server's configured five-second decision window.
- Added a UI regression assertion for the five-second label and to reject the obsolete three-second wording.
- Latest Render deploy: dep-dbksllh9dmos739ntrk0 — LIVE.
- Final /health check: status=ok, 200 history candles, WebSocket subscribed, finalAlertWindowSeconds=5, signalHoldSeconds=35.
- The main strategy CI run 41630630422 passed. The subsequent UI text/assertion-only commits were deployed; their new assertion has not yet been separately reported by a GitHub Actions run.
