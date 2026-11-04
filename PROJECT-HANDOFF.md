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


## Latest mobile and Telegram readiness update (2026-11-04)
- Added Telegram WebApp SDK initialization (ready and expand) for Telegram in-app launch.
- Countdown polling is 1 second; 10s and 3s cues use threshold-crossing guards and separate per-candle deduplication, preventing missed exact-second events and shared-key collisions.
- Audio uses a ramped Web Audio tone and resumes the audio context after the user's sound-toggle gesture; haptics use Telegram HapticFeedback where available plus Android vibration fallback.
- Backend sends one Telegram message when a new CALL/PUT signal is first created for a closed M1 candle, provided TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured.
- Telegram credentials must be added in Render as a merge update (never replace existing variables). No secret values are stored in Git.
- Physical Xiaomi 11T sound/vibration and actual Telegram delivery still require on-device verification after credentials are set.


## Alert timing correction (2026-11-04)
- Backend calculates remaining M1 seconds with a ceiling-based countdown and exposes CALL/PUT only while the current candle has 10 seconds or less remaining; before that, the UI receives STANDBY.
- Telegram signal delivery is gated server-side to the final 10 seconds and deduplicated once per closed-candle signal.
- The client 10-second preparation cue is restricted to countdown 1–10 seconds; the 3-second entry cue and vibration are restricted to countdown 1–3 seconds. Both are deduplicated per candle.
- Removed duplicate legacy beep/vibration function declarations so the ramped audio and Telegram haptic implementations remain active.
- Deployment/device verification must confirm /api/market countdown and signalWindowOpen, Telegram credentials, and physical Xiaomi 11T audio/haptic behavior.
