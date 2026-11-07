# VISUAL-SIGNAL-AI v1.1.0 — Isolated Vision Workspace

This workspace is isolated on `feature/isolated-10ai-engine`. Production Signal Radar PRO / Main Market is not part of this build.

## Gemini Vision backend
- Runtime: Node.js 20+, no third-party runtime dependencies.
- Provider/model: Gemini API / `gemini-2.5-flash`.
- Set `GEMINI_API_KEY` only in the Render service Environment dashboard. Never commit the key or embed it in the APK.
- Optional `GEMINI_VISION_MODEL` defaults to `gemini-2.5-flash`.
- `GET /health` reports provider/model and whether the key is configured; it never returns the key.
- `POST /api/v1/vision/signal` accepts one JSON Base64 screenshot or multipart image. It returns `{ok,signal,confidence,reason,symbol,timeframe,provider,model}`.
- Signals are CALL, PUT, or STANDBY. Confidence below 0.70 is forced to STANDBY. No 200-candle/OHLC-history gate is applied to this single-image endpoint.
- Maximum upload is 8 MiB. Gemini Free Tier quotas/rate limits still apply; no provider can guarantee zero quota errors or unlimited free usage.

JSON request:
```json
{"imageBase64":"<base64>","mimeType":"image/jpeg","chartContext":{"symbol":"EUR/USD","timeframe":"M1"}}
```

## Android APK
- Gradle project: `android/`
- Application ID: `com.kawasaki.visualsignalai`
- Version: `1.1.0`
- Build: `gradle -p android assembleDebug`
- Workflow: `.github/workflows/visual-signal-ai-apk.yml`, scoped to this branch and isolated Android paths.
- User must grant Android screen-capture consent and overlay permission. A draggable icon-only floating control captures one frame only after manual tap. A thin top-edge bar shows green CALL, red PUT, or grey STANDBY.
- Endpoint is compiled into the isolated APK as the isolated Render URL. No API key is stored in the client.

## Important verification status
Source code and the isolated Render deployment are updated separately from production. Before distributing the APK, verify GitHub Actions build success, configure `GEMINI_API_KEY` in Render, verify `/health` reports `visionConfigured:true`, then perform a real manual screenshot POST/device test. A healthy process without a configured key is not an end-to-end Gemini test.
