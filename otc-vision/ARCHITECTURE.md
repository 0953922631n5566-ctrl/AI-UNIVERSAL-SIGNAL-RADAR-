# OTC Vision Signal Radar — Server-Side Frame Analysis

**Status:** Android one-tap full-frame uploader and server OCR source are implemented on the isolated branch. Backend deployment, a compatible server URL/token, Xiaomi device testing, and directional engine integration remain pending.

## Isolation contract

- Work only on \`feature/otc-vision-apk\`.
- Do not merge into \`main\` or \`main-market\`.
- Do not modify or deploy to the Main Market Render service.
- No Twelve Data, Telegram, Firebase, FCM, broker API, or order execution.
- OTC Vision uses its own Android application ID: \`com.otcvision.radar\`.

## Client architecture

1. User configures an HTTPS backend base URL and ingest token in the app.
2. Token is encrypted with an Android Keystore AES-GCM key; only ciphertext is stored in app-private preferences.
3. User explicitly starts MediaProjection and permits the single floating action button.
4. The only floating control is a draggable **CAPTURE & SEND** button.
5. Each tap arms one frame. Idle ImageReader frames are immediately closed without Bitmap conversion.
6. The next frame is wrapped once as a Bitmap solely for JPEG encoding, uploaded as multipart to \`POST /v1/frame\`, then recycled in a \`finally\` block.
7. The client performs no ROI crop, image filtering, local OCR, candle extraction, or signal calculation. It displays the server's signal/status/reason response on the floating button and in the app.

### Upload contract

- HTTPS endpoint: \`{serverBaseUrl}/v1/frame\`
- Authentication: \`Authorization: Bearer <RADAR_INGEST_TOKEN>\`
- Multipart fields: \`session_id\`, \`sequence\`, \`captured_at_ms\`, \`width\`, \`height\`, and \`image\` (JPEG).
- JPEG quality is reduced in bounded steps to stay under the server's 4 MB frame limit.
- Connect timeout: 10 seconds; response timeout: 20 seconds.
- No screenshot is written to local storage by the uploader.
- Android must still allocate one temporary full-frame Bitmap and one compressed JPEG byte array; therefore memory use is reduced, not zero. Capture/encoding/network/platform failures are caught and reported, but no software can guarantee zero crashes under every OS or fatal-memory condition.

## Server architecture

- \`backend/app.py\` authenticates the request, validates dimensions, payload size, MIME signature, timestamp, and monotonically increasing sequence.
- \`backend/vision_ocr.py\` decodes the image in memory, searches the right-hand axis for an orange tag, crops the detected tag, enlarges it, denoises/thresholds it, and runs Tesseract OCR against numeric characters.
- The screenshot is not persisted. The server retains only bounded in-memory session metadata and a truncated SHA-256 evidence identifier.
- \`backend/Dockerfile\` installs the Tesseract binary and Python OCR dependencies.
- The server returns the extracted price and OCR status where possible.

## Directional signal safety / 10-engine gap

- A search of this branch did not find the requested ten OTC Signal Engine implementations or a validated chart-perception/decision adapter.
- The existing backend was a frame-ingestion stub that only hashed uploads and returned STANDBY. The new code adds server-side orange-tag OCR, not the missing ten strategies.
- The API therefore always returns \`signal=STANDBY\` and \`PRICE_READ_ENGINE_NOT_CONFIGURED\` when OCR succeeds. It must not emit CALL/PUT until the exact ten engine sources are identified, ported, supplied with suitable candle/chart inputs, and independently validated.
- A single current price is not enough to calculate ten defensible directional strategies. Full screenshot capture creates the possibility of chart perception, but chart/candle extraction is not yet implemented.

## Backend deployment requirements

- Deploy only the dedicated OTC backend from this branch, using build context at repository root and Dockerfile path \`backend/Dockerfile\`.
- Set server environment variable \`RADAR_INGEST_TOKEN\` to a strong random secret.
- The Android app must be configured with that service's HTTPS base URL and the same token.
- This source change does not itself deploy a Render service or alter any existing service. Do not claim the endpoint is live until a dedicated deployment and authenticated test upload succeed.

## Device validation checklist

- Install the newly built debug APK on Xiaomi 11T / Android 14.
- Save the dedicated HTTPS backend URL and token; verify the token is encrypted by the Android Keystore-backed config store.
- Grant overlay and fresh MediaProjection consent.
- Open the broker screen and tap **CAPTURE & SEND** once.
- Verify exactly one multipart POST, the received frame dimensions, orange-tag OCR result, server response, and on-screen status.
- Repeat with permission revocation, no network, HTTP 401/413/5xx, rotation, and rapid double taps.
- Measure memory and thermal behavior. A full-frame capture still requires temporary image memory; this design removes local ML Kit and local preprocessing but does not make memory usage zero.

## Build and release

- Workflow: \`.github/workflows/otc-vision-apk.yml\`.
- Android build: \`otc-vision/app\`.
- Debug artifact must be downloaded and APK SHA-256 verified before sharing.
- Build success is not proof of server deployment or Xiaomi hardware behavior.
