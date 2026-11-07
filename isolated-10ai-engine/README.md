# AI-10 CORE — Isolated Vision Test Workspace

Standalone development copy of the ten-engine strategy subsystem. Production `main-market` paths are not modified.

## Run locally

Node.js 20+; no third-party runtime dependencies.

```sh
cd isolated-10ai-engine
OPENAI_API_KEY=your_key npm start
npm test
npm run check
```

## Test server

- `GET /health` — server/provider configuration status (never exposes the API key).
- `POST /api/v1/vision/analyze-chart` — accepts JSON Base64 or multipart JPEG/PNG/WebP screenshots.
- Configure `OPENAI_API_KEY` as a Render environment secret. Optional `OPENAI_VISION_MODEL` defaults to `gpt-4o`.

JSON example:

```json
{
  "imageBase64": "<base64 JPEG bytes>",
  "mimeType": "image/jpeg",
  "chartContext": {
    "symbol": "EUR/USD",
    "timeframe": "M1",
    "tickAgeSeconds": 3
  }
}
```

Multipart uses file field `image` and JSON field `chartContext`. Maximum image size is 8 MiB.

## Strict extraction policy

`src/vision-adapter.js` calls OpenAI Chat Completions with GPT-4o Vision, temperature 0, and strict JSON Schema output. It asks for visible market structure, trend, candlestick patterns, numerical indicator states, and individually legible OHLC candles. It rejects unreadable images, confidence below 0.98, fewer than 200 candles, invalid OHLC geometry, missing indicators, symbol/timeframe mismatch, and missing trusted freshness metadata. It never fills missing values with estimates.

Important limitation: chart screenshots often do not expose 200 exact candle timestamps and OHLC digits or all required indicator numbers. In those cases the endpoint intentionally returns HTTP 422. A screenshot itself cannot prove live-feed freshness, so the caller must supply trusted `tickAgeSeconds <= 25`, or explicitly permitted REST freshness metadata (`allowRestFallback: true`, `ageSeconds <= 180`). The vision model's confidence is a model estimate, not a mathematical guarantee of pixel-reading accuracy. For production-grade numeric OHLC, use a trusted market-data feed; use vision for qualitative visual context.

HTTP status codes: 200 accepted and dispatched; 400 malformed input; 413 oversized upload; 415 unsupported media; 422 unreadable/invalid/incomplete extraction; 503 missing API key/provider rate limit; 502 provider failure.

## Isolation

This workspace is on `feature/isolated-10ai-engine`. It does not modify or deploy the production `main-market` service. The Render test server must be created as a separate service from this branch.
