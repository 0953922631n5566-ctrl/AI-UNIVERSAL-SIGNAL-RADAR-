# AI Universal Signal Radar · OCR-only

The server accepts real EUR/USD prices sent by the Android OCR capture app. It does not call Twelve Data, another market-data API, or generate synthetic prices.

## Runtime
- Node.js 18.x
- Build: `npm install`
- Start: `npm start`
- Render serves the Telegram Mini App from `public/index.html`.

## OCR ingestion contract
The APK must send an HTTPS POST to `/api/upload-screen`:

```json
{
  "detectedPrice": 1.105045,
  "timestamp": 1793700000000,
  "symbol": "EUR/USD",
  "source": "ANDROID_OCR"
}
```

- `detectedPrice` is required and must be a real positive number read from the screen.
- `timestamp` is optional; if present it must be a current Unix timestamp in milliseconds or an ISO timestamp.
- `symbol` defaults to EUR/USD; other symbols are rejected.
- Optional authentication: set `OCR_INGEST_TOKEN` in Render and send the same value in the `x-ocr-token` header. Never embed reusable secrets in public source code.
- Duplicate same-price frames within one second are ignored.
- No fallback/random price is generated.
- A price older than 30 seconds causes STANDBY.
- At least five distinct OCR readings are required before directional momentum is assessed. This is a simple short-term momentum heuristic, not a probability or proven trading strategy.
- Manual decision support only; no broker orders are placed.

## Endpoints
- `GET /health`: service and OCR freshness status.
- `GET /api/signal`: current OCR-derived state; does not fetch market data.
- `POST /api/upload-screen`: accepts APK OCR price readings.
- `GET /api/config`: server configuration.

## APK integration status
This server deployment does not itself update the Android APK. The APK must POST OCR results to `/api/upload-screen`. Until that APK change is built and installed, the Mini App correctly remains WAITING APK / STANDBY.
