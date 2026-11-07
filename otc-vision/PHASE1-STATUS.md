# OTC Vision Radar — Server-Side Capture Phase

Branch: feature/otc-vision-apk
Status: crash-resilience source patch committed; clean Android APK build verified. Backend deployment is live; Xiaomi 11T retest is pending.

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

## Crash-resilience patch — 2026-11-07

- Added kotlinx-coroutines-android and moved JPEG compression plus all HTTP operations into a Dispatchers.IO coroutine.
- ImageReader frame pixels are copied to an independently owned Bitmap; the Image is closed immediately before asynchronous upload. The Bitmap remains valid until the upload job completes and is then recycled in its completion handler.
- The full capture/upload path catches Throwable, reports the stage and exception, restores the floating button to FAILED · TAP TO RETRY, and shows a Toast. HTTP failures do not terminate the app.
- ManualFloatingControls now marshals every View/WindowManager mutation to the main thread, preventing capture-thread UI access.
- FrameUploader rejects main-thread invocation as a defensive invariant.
- Fresh CI build and Xiaomi 11T retest are pending. Do not mark the device crash fixed until the user repeats the live capture test.

## Hardware test

After APK artifact verification and backend deployment, configure server URL/token in the app, grant overlay + MediaProjection permissions, and verify one tap creates one POST and one server response. Exercise network errors, stale frames, permission revocation, rapid taps, memory, and thermal behavior.


## Crash-fix build verification — 2026-11-07

- Clean build workflow run #90 / ID 42348413792 completed successfully on `feature/otc-vision-apk`.
- Build source/head commit: `75c37aad670555661adc784891bb7fa661dd1df0`.
- Workflow explicitly ran `:app:clean :app:testDebugUnitTest :app:assembleDebug`; Gradle reported `BUILD SUCCESSFUL in 31s`.
- Note: `:app:testDebugUnitTest` reported `NO-SOURCE`; no Android unit test source files currently exist. Backend OCR parser suite ran 5 tests and passed.
- Artifact ID: 13564397743; artifact name `otc-vision-finetuned-debug-apk`; archive size 1,348,098 bytes.
- Extracted APK size: 1,356,315 bytes.
- APK SHA-256: `64f7f1b369252f8e266aff119fd0574c928dbb8279167e53943f5ad748381f83`; independently recomputed from the downloaded APK and matches the workflow checksum file.
- Workflow: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/42348413792
- This verifies clean compilation, packaging, and artifact integrity only. It does NOT prove the Xiaomi 11T crash is resolved; user must install this new APK and repeat the capture/upload test. Main Market source and service remain untouched.
