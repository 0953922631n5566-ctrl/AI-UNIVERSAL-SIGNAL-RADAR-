# OTC Vision Signal Radar — Phase 1

Standalone Android application under `otc-vision/`, isolated from the legacy Android app, backend, and Main Market workflows.

## Isolation guarantees
- Application ID: `com.otcvision.radar`, distinct from the Main Market app.
- No INTERNET permission and no networking dependency.
- No backend URL, API token, Firebase, FCM, Telegram, Render, Twelve Data, or remote analytics.
- Captured frames and OCR text are processed in memory and are not persisted.
- No broker login automation, taps, order placement, or trade execution.
- Work only on `feature/otc-vision-apk`; do not merge to `main` or `main-market` without separate approval.

## Build
With JDK 17 and Android SDK platform/build-tools 35 installed:
```sh
gradle --no-daemon :app:assembleDebug
```
APK output: `app/build/outputs/apk/debug/app-debug.apk`.

## Phase 1 implementation
- Explicit MediaProjection consent for each capture session.
- Foreground service with Android `mediaProjection` type and ongoing notification.
- ImageReader screen-frame acquisition with bounded frame rate and lifecycle cleanup.
- Two normalized ROIs: price-label and candle-chart.
- Grayscale, contrast adjustment, and 3x3 median noise reduction for price OCR.
- Bundled Google ML Kit Latin text recognizer (on-device model).
- Conservative parser: one numeric candidate is displayed; zero candidates returns NO_PRICE; multiple candidates returns AMBIGUOUS.
- Per-observation OCR latency, frame age, and app heap-use metrics.

## ROI calibration warning
Initial fractions in `RoiConfig.kt` are placeholders, not broker-specific calibration. The price ROI defaults to an upper-right region; the chart ROI defaults to the central chart area. Adjust and validate against the actual OTC platform before measuring accuracy. Candle geometry/OHLC inference and CALL/PUT strategy decisions are not part of Phase 1.

## Xiaomi 11T benchmark protocol
1. Install the debug APK on Xiaomi 11T / Android 14.
2. Open the OTC broker chart manually and ensure the selected capture areas contain no sensitive account details.
3. Start capture and approve Android's system consent prompt.
4. Collect at least 100 observations per broker layout across normal, low-contrast, zoomed, and moving-price conditions.
5. Record median/p95 OCR latency, exact-match price accuracy, ambiguous/no-read rate, app heap, and device temperature over a 15-minute run.
6. Repeat with app switching, screen rotation, permission revocation, and battery saver.
7. Stop capture and verify the ongoing notification disappears.

The app displays per-observation OCR latency and heap use. Physical accuracy, thermal throttling, and sustained memory measurements require execution on the actual Xiaomi 11T with representative OTC broker screens; CI cannot establish these results.

## Capture implementation note
CameraX ImageAnalysis is intended for camera frames. MediaProjection screen frames are consumed through Android ImageReader, which is the appropriate source here. No camera permission or camera stream is requested.
