# AI Universal Signal Radar — Connection + Telegram Only

This repository has been reduced to a minimal connection-status service and an authenticated Telegram notification gateway.

## Retained
- Node.js 18 + Express server
- Static connection-status page
- `GET /health` and `GET /api/connection`
- Authenticated `POST /api/telegram/notify`

## Removed
Android APK / screen capture, OCR and price extraction, image/frame ingestion, candle aggregation, indicators, forecast/signal engines, trading UI, related tests, and APK build workflows.

## Render environment variables
Set these in the Render service environment:
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `TELEGRAM_CHAT_ID` — destination chat or channel ID
- `TELEGRAM_NOTIFY_TOKEN` — private bearer token required by the notification endpoint

The server never returns secret values from status endpoints. Existing Render environment variables are not overwritten by this source cleanup.

## API
- `GET /health` — server health and non-secret configuration flags
- `GET /api/connection` — connection status
- `POST /api/telegram/notify` — send a Telegram text message

Example request:
```http
POST /api/telegram/notify
Authorization: Bearer <TELEGRAM_NOTIFY_TOKEN>
Content-Type: application/json

{"message":"Connection test"}
```

No OCR, screenshot capture, price ingestion, market data, indicators, trading signals, or broker execution are included.
