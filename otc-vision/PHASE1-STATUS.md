# OTC Vision Radar — Server-Side Capture Phase

Branch: feature/otc-vision-apk
Status: source changes committed; fresh Android + backend parser CI build running. Backend deployment and Xiaomi 11T testing are pending.

## Implemented in source

- One floating CAPTURE & SEND button; movable/resizable ROI overlay removed.
- Single-frame, on-demand full-screen capture. Idle ImageReader frames are closed without Bitmap creation.
- Android client no longer includes ML Kit or local OCR/preprocessing/candle/signal logic.
- Full-screen JPEG multipart uploader posts to /v1/frame with Bearer authentication.
- Server URL/token settings are stored in app-private preferences; token ciphertext uses Android Keystore AES-GCM.
- Server FastAPI validates the frame and runs OpenCV orange-tag detection/cropping/upscaling/filtering plus Tesseract OCR.
- Backend tests cover strict numeric price parsing.
- No screenshot file persistence; server processes frame bytes in memory.

## Known limitations / release gates

- Android capture still needs a temporary full-frame Bitmap and compressed JPEG buffer. It cannot have zero memory overhead, although local ML Kit and image-preprocessing allocations are removed.
- No exact OTC 10-engine implementation was found in this branch. Server therefore always returns STANDBY, including after a successful price read (PRICE_READ_ENGINE_NOT_CONFIGURED).
- Backend Dockerfile and API code are committed but no dedicated Render/backend deployment has been made. App requires the deployed HTTPS base URL and matching RADAR_INGEST_TOKEN.
- CI build does not validate Android MediaProjection behavior or OCR accuracy on Xiaomi 11T.
- CALL/PUT remain disabled until ten strategy sources are ported and independently evaluated using appropriate chart/candle data.

## Hardware test

After APK artifact verification and backend deployment, configure server URL/token in the app, grant overlay + MediaProjection permissions, and verify one tap creates one POST and one server response. Exercise network errors, stale frames, permission revocation, rapid taps, memory, and thermal behavior.
