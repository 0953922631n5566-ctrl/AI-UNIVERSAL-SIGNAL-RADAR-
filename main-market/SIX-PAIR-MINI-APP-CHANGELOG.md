# Six-pair Mini App update — 2026-11-09

## Scope
- Main Market Mini App only; no APK, Telegram chat messages, OCR, or broker execution changes.
- Supported M1 symbols: AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- EUR/USD remains the default pair.
- Only one pair is subscribed to Twelve Data Streaming at a time. Selecting another pair closes the prior stream, syncs the selected pair's 54 closed candles, and subscribes to the new pair.
- Added authenticated POST /api/telegram/select for Mini App pair changes.
- Snapshot now includes cached state for all six pairs and the selected pair.
- Mini App displays a selector and ten numbered API key status cells without exposing credentials.

## API key status semantics
- Green ACTIVE/READY: key is not currently in cooldown and is eligible for pool selection.
- Red COOLDOWN: key is temporarily unavailable after a rate-limit, auth, provider, or transient failure.
- Grey NOT SET: that numbered key is not configured.
- Status is based on the key pool's recorded outcomes/cooldowns; the UI does not spend ten API calls to probe every key independently.

## Preserved behavior
- M1 timeframe, 50 context + 4 latest closed candles (54 total).
- Existing AI 9 + System 10 analysis, signal release gate, signal timing, and 40-second signal hold.
- Existing 2-second Mini App polling and M1 countdown display.
- No simultaneous six-pair scanning; no change to analysis thresholds or decision logic.


## Two-stage sound and visual alerts — 2026-11-09
- Added an explicit one-tap sound unlock/test control to satisfy mobile browser audio autoplay restrictions.
- A single short two-tone warning plays once when the current M1 candle has 10 seconds or less remaining. It is explicitly labeled as a watch-only reminder, not a CALL/PUT signal.
- A distinct multi-tone alert plays on a new server-issued CALL/PUT alertId. CALL and PUT use different tone sequences.
- Real signals trigger a color-coded flashing signal panel, an on-screen alert banner, and device vibration / Telegram haptic feedback where supported.
- Alerts are generated only while the Mini App is open and visible; hidden/background pages pause polling and cannot guarantee sound.
- No changes to analysis logic, signal timing, thresholds, API usage, or backend endpoints.


## Next-M1 Forecast V2 — isolated validation branch (2026-11-09)
- Branch `feature/next-m1-forecast-v2`; no production deployment or changes to `main-market` yet.
- Market context/indicators now use all 54 latest closed M1 candles so regime and technical values are aligned with the latest four entry candles.
- System 10 now aggregates weighted evidence across independent analyst groups, requiring at least two analysts from two groups by default, score >=60 and directional conflict margin >=0.12. A single-engine exception requires score >=70 plus at least five independent technical confirmations.
- Added M1 regime, M5 conflict, elevated volatility, nearby support/resistance and extreme RSI filters. Evidence-strength score is not a probability of winning.
- Forecast dispatch moves to the first 0–5 seconds of the target candle, using only the previous fully closed candle and a fresh live tick. Signals are not backdated if the entry window is missed. Old signals are cleared at target-candle rollover; visibility extends through the target candle.
- Server records entry tick vs target-candle close outcomes, rolling last-100 stats and structured logs.
- This is an experimental formula revision. No out-of-sample or live paper-trading accuracy has been established.
