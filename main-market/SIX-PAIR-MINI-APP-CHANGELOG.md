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
