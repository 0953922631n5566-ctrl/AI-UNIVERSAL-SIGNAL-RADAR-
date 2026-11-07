# OTC Vision Signal Radar — Dynamic Price Tag OCR

Standalone Android application under `otc-vision/`, isolated from legacy apps, backend, and Main Market workflows.

## Isolation guarantees
- Application ID: `com.otcvision.radar`, distinct from the Main Market app.
- No INTERNET permission and no networking dependency.
- No backend URL, API token, Firebase, FCM, Telegram, Render, Twelve Data, or remote analytics.
- Captured frames and OCR text are processed locally; benchmark CSV is stored in app-private files.
- No broker login automation, taps, order placement, or trade execution.
- Work only on `feature/otc-vision-apk`; do not merge to `main` or `main-market` without separate approval.

## Dynamic price-tag pipeline
- Right-axis scan ROI spans x=78–99.5% and y=10–90% of the captured screen.
- Orange pixels are segmented and connected components anchor a padded crop around the moving price tag.
- The crop is enlarged when small, orange background is mapped to white, bright quote glyphs are contrast-stretched, and a summed-area-table local adaptive threshold produces dark glyphs on a light canvas.
- OCR runs only on the detected tag. No tag reports `NO_ORANGE_TAG`.
- Price parser accepts 1–3 integer digits and 5–6 fractional digits (e.g. `1.13520`, `1.135203`, `1.135475`). Multiple valid candidates remain `AMBIGUOUS`.

## Automatic 100-frame benchmark
- Starting a MediaProjection capture automatically resets and starts a local 100-sample run.
- Samples include OCR status/value, OCR and frame latency, Java heap usage, Android thermal status, and battery temperature where available.
- The CSV is written to the app-specific Documents directory (`Android/data/com.otcvision.radar/files/Documents/benchmark/ocr-100-<timestamp>.csv`; internal app files are used only if external app storage is unavailable). The UI status reports progress and a completion summary.
- Extraction rate means the percentage of sampled frames that produced a syntactically valid quote. It is **not** exact-match accuracy.
- The CSV includes an intentionally blank `exact_match` column. Fill it only after comparing each sample with a separately recorded ground-truth quote. Do not claim price accuracy from extraction rate alone.
- Battery temperature is not SoC temperature. Thermal status may be unavailable on older Android versions.

## Xiaomi 11T validation
Install the newest APK and run one continuous capture with the broker price tag visible. Keep the screen content representative for all 100 samples. After `BENCHMARK_COMPLETE 100/100`, export the CSV from app-private storage using a debug/device extraction workflow and compare each row to a timestamp-matched visible quote. The source change does not claim a completed physical-device benchmark.

## Build
With JDK 17 and Android SDK platform/build-tools 35 installed:
```sh
gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug
```
APK output: `app/build/outputs/apk/debug/app-debug.apk`.

## Capture implementation
MediaProjection frames are consumed through Android ImageReader. No camera permission or camera stream is requested. Phase 1 remains OCR-only: candle geometry/OHLC inference, CALL/PUT strategy decisions, alerts, and trade execution are out of scope.
