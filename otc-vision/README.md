# OTC Vision Radar — Server-Side Capture Client

Standalone Android client and FastAPI OCR service, isolated from Main Market.

## Current client behavior

- Android package: com.otcvision.radar.
- One draggable floating button: CAPTURE & SEND.
- No movable ROI, no local ML Kit, no local OCR, no local image filtering or candle analysis.
- ImageReader drains and closes idle frames. A tap arms one full-screen frame.
- The captured Image is copied into an independently owned Bitmap and closed before upload begins. JPEG encoding and HTTPS multipart POST /v1/frame run on Dispatchers.IO, never on the Android main thread.
- A dedicated SupervisorJob coroutine owns each upload; the Bitmap is recycled only after upload completion, including cancellation/error paths.
- FrameUploader has a main-thread guard so accidental UI-thread invocation fails fast and is converted into a visible FAILED state.
- Floating button View/WindowManager changes are marshalled to the Android main thread. Network, HTTP, JPEG, and capture failures are caught as Throwable, logged, and surfaced as FAILED + Toast instead of escaping the capture pipeline.
- Temporary full-screen Bitmap/JPEG memory is still required by Android capture and encoding; memory overhead is reduced, not zero.
- Server base URL and ingest token are configured in the app. The token is encrypted using Android Keystore AES-GCM.
- The screenshot is not written to local storage by the upload module.

## Backend behavior

- FastAPI validates Bearer token, dimensions, MIME signature, payload size (4 MB), timestamp freshness, and frame sequence.
- Server-side OpenCV detects an orange price tag on the right-hand price axis, crops and enlarges it, applies contrast/noise filtering, then runs Tesseract OCR.
- The backend returns price candidates and OCR status. The uploaded screenshot is processed in memory and not persisted.
- Build backend container from repository root with backend/Dockerfile; set RADAR_INGEST_TOKEN to a strong random secret.
- This source is not deployed automatically by the Android workflow. Configure a dedicated OTC backend service and use its HTTPS base URL in the app.

## Signal-engine status

CALL/PUT remain disabled. No matching set of ten OTC Signal Engine implementations was found in this branch. The server currently returns STANDBY even when OCR extracts a price, with status PRICE_READ_ENGINE_NOT_CONFIGURED. Do not interpret price extraction as a directional recommendation.

The ten engine sources and their required candle/chart inputs must be supplied/ported and independently tested before enabling directional output. A single price observation is not enough.

## Build

JDK 17 + Android SDK 35:
    gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug

The branch workflow additionally installs backend OCR dependencies and runs backend price-parser tests before building the APK.

## Xiaomi 11T validation

1. Configure the dedicated backend HTTPS URL and matching ingest token.
2. Start MediaProjection and allow the floating button.
3. Open the broker screen and tap CAPTURE & SEND once.
4. Verify the server receives one full-screen JPEG and returns OCR status/price.
5. Test no network, 401, 413, 5xx, revoked projection, rapid taps, rotation, memory and thermal behavior.

Build success is not proof of server deployment or device behavior. No Main Market service or branch is changed.
