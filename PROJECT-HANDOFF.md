# PROJECT HANDOFF — AI Universal Signal Radar

Updated: 2026-11-04
Branch: feature/server-price-extraction

## Active scope
The project is intentionally reduced to ONLY:
1. Basic HTTP connection/health status.
2. Telegram notification delivery.

## Retained files
- `server.js` — Express connection endpoints and authenticated Telegram send endpoint.
- `public/index.html` — minimal server/Telegram connection status UI.
- `package.json` — minimal Node.js runtime dependency.
- `README.md` — API and Render environment setup.

## Explicitly removed from this branch
- Android APK project, MediaProjection, screen capture and OCR.
- Raw OCR text ingestion, price parsing, price/candle state, M1 aggregation.
- Indicator calculations, forecast engine, CALL/PUT/STANDBY trading analysis UI.
- Python frame-ingestion backend.
- OCR/price/forecast test suites and Android/APK GitHub Actions workflows.
- Historical OCR/market handoff and strategy documents.

## Telegram configuration
Render environment variables:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- TELEGRAM_NOTIFY_TOKEN

The status endpoints expose only whether configuration exists, never secret values. The send endpoint requires Authorization: Bearer TELEGRAM_NOTIFY_TOKEN and accepts a JSON body with a message up to 4,000 characters.

## Endpoints
- GET /health
- GET /api/connection
- POST /api/telegram/notify

## Deployment notes
The Render service's existing environment variables must be preserved; do not replace the complete environment set during this cleanup. Deploy the cleaned branch only after confirming the intended Render workspace and service. After deployment, verify /health and /api/connection. Telegram delivery requires valid bot token, chat ID, and notification bearer token in Render.

## Safety
No APK, OCR, screenshot capture, price extraction, market API, candle engine, forecast, CALL/PUT generation, or broker execution exists in this codebase state.
