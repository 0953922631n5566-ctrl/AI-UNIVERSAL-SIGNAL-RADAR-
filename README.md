# AI SIGNAL RADAR OCR CLEAN · Server Price Extraction

The Android app captures the full visible screen, runs OCR, and sends the raw recognized text to the server. The server alone extracts a price and builds M1 candles. There is no Twelve Data integration, other external market-price API, synthetic price, random fallback, or automatic broker order.

## Runtime
- Node.js 18.x
- `npm install`
- `npm test`
- `npm start`

## Android → server contract
The APK sends `POST /api/ocr/price` with JSON:

```json
{
  "symbol": "EUR/USD",
  "market": "OTC",
  "rawText": "EUR/USD\n1.08456",
  "timestamp": 1793700000000
}
```

The APK must not extract a price, crop a presumed price badge, or send `detectedPrice`. Server extraction rejects ambiguous/missing price candidates rather than guessing. Configure `OCR_API_TOKEN` on the test server and provide the same token in the APK's token field. The token is sent as `X-API-Token`.

## Analysis rules
- M1 candles are aggregated only from timestamped OCR observations.
- A candle is marked closed only when an observation from the immediately following minute arrives.
- A missing M1 minute resets the candle history; no candles are fabricated.
- At least 6 consecutive completed M1 candles are required.
- Indicators: EMA(3/5), RSI(5), MACD(3/5/2).
- Missing/ambiguous/stale/duplicate/out-of-order/stuck data returns STANDBY.
- A flat quote that does not change for 20 seconds is treated as stuck and blocks signals.
- CALL/PUT are emitted only when all configured indicator conditions align; otherwise STANDBY.

## Endpoints
- `GET /health`: server mode, counters, and token configuration.
- `GET /api/config`: extraction and indicator configuration.
- `GET /api/signal?symbol=EUR/USD&market=OTC`: current server-side state.
- `POST /api/ocr/price`: raw OCR ingestion.

## Test/deployment safety
The Android `BACKEND_URL` is intentionally set to `https://REPLACE_WITH_TEST_SERVER_HOST`. Replace it only with a controlled test server after configuring its token. Do not point the APK at the Render production URL yet. No Render deployment is part of this branch; first run automated tests, build/install the APK, and verify real device request/response logs.
