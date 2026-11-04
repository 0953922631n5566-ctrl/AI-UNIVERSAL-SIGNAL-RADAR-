# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-04
Branch: feature/server-price-extraction

## Active specification
- Main Market (Non-OTC), EUR/USD, M1 only.
- Twelve Data REST time series; no OCR, Android APK, 8xTrade, broker execution, or OTC.
- Express backend with a guarded 15-second data cache, API request spacing, 200-candle history, stale-candle fail-closed behavior, and STANDBY on missing/invalid data.
- Adaptive analysis: EMA 9/21/50, RSI 14, MACD 12/26/9, candle price action, 20-candle support/resistance, range volatility, and momentum.
- Regimes: TRENDING, RANGING, HIGH VOLATILITY, REVERSAL, UNCLEAR.
- Strict evidence threshold: 64%; conflict, unclear regime, high volatility, or stale data => STANDBY.
- Signal display lifetime: 40 seconds; one signal per closed candle.
- Mini App shows signal, price, regime, reason, evidence score, M1 countdown, and API state; browser sound/vibration controls.

## Files
- server.js — market data ingestion, rate guard, freshness guard, analysis and Telegram notification endpoint.
- package.json — Node 18 / Express.
- public/index.html — responsive Mini App.

## Render environment
Preserve existing variables and secrets. Required market variable:
- TWELVE_DATA_API_KEY

Existing Telegram variables remain supported:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- TELEGRAM_NOTIFY_TOKEN

Never print or commit secret values. Add TWELVE_DATA_API_KEY in Render Dashboard if not already configured.

## Endpoints
- GET /health
- GET /api/connection
- GET /api/market
- POST /api/telegram/notify (Bearer TELEGRAM_NOTIFY_TOKEN)

## Verification checklist
- Confirm Twelve Data key exists in Render environment.
- Confirm /api/market returns fresh EUR/USD M1 candles and indicators.
- Confirm rate-limit, missing-key, stale-data, and conflicting-evidence paths return STANDBY.
- Confirm Mini App sound/vibration after user interaction; mobile browsers may require a tap to unlock audio.
- Confirm deployment LIVE and inspect Render logs after deploy.

## Known limitations / honest status
The 64% value is a deterministic evidence score (count of five directional evidence groups), not a statistically calibrated probability or win-rate estimate. No strategy profitability is claimed. Browser audio/vibration depends on device/browser permissions and user interaction. Telegram delivery remains a separate authenticated endpoint.
