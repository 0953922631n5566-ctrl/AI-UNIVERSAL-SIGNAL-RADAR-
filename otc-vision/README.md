# OTC Vision Signal Radar — Dynamic Price Tag OCR

Standalone Android application under `otc-vision/`, isolated from legacy apps, backend, and Main Market workflows.

## Isolation guarantees
- Application ID: `com.otcvision.radar`, distinct from the Main Market app.
- No INTERNET permission and no networking dependency.
- No backend URL, API token, Firebase, FCM, Telegram, Render, Twelve Data, or remote analytics.
- Captured frames, OCR text, and debug images are processed/stored locally.
- No broker login automation, taps, order placement, or trade execution.
- Work only on `feature/otc-vision-apk`; do not merge to `main` or `main-market` without separate approval.

## Dynamic orange price-tag OCR
- Right-axis scan ROI spans x=78–99.5% and y=10–90% of the captured screen.
- Orange pixels are segmented and connected components anchor a padded crop around the moving price tag.
- Every anchored crop is enlarged exactly 2x using a Catmull-Rom bicubic resampler.
- Preprocessing detects light-vs-dark glyph polarity, maps the orange container to a clean white canvas, expands glyph contrast, and applies integral-image local adaptive thresholding to produce dark glyphs on a light background for ML Kit.
- OCR output is sanitized to the strict numeric character set `[0-9.]+` (comma decimal separators and common O/I/l confusions are normalized first) before price validation.
- **ML Kit Text Recognition does not expose a configurable character whitelist.** Filtering is therefore applied to recognized text before the price parser, not claimed as a recognizer option.
- Price validation accepts 1–3 integer digits and exactly 5–6 fractional digits (e.g. `1.13520`, `1.135203`, `1.135475`). Multiple valid candidates remain `AMBIGUOUS`.

## Failed OCR debug snapshots
- If OCR returns no unique valid price or ML Kit fails, the preprocessed bitmap is saved best-effort under app-specific local storage:
  `Android/data/com.otcvision.radar/files/Pictures/ocr-debug/`
- At most five snapshots are saved per capture session. File/storage/bitmap errors are caught and must not interrupt capture.
- Debug images never leave the device automatically.

## Automatic 100-frame benchmark
- Starting a MediaProjection capture automatically resets and starts a local 100-sample run.
- Samples include OCR status/value, OCR and frame latency, Java heap usage, Android thermal status, and battery temperature where available.
- CSV is written to the app-specific Documents directory:
  `Android/data/com.otcvision.radar/files/Documents/benchmark/ocr-100-<timestamp>.csv`
- Extraction rate is the percentage of frames producing a syntactically valid quote; it is **not** exact-match accuracy. Exact-match requires timestamp-matched ground truth for each sample.
- Battery temperature is not SoC temperature. Thermal status may be unavailable on older Android versions.

## Xiaomi 11T validation
1. Install the newest APK and grant MediaProjection consent.
2. Keep the orange quote tag visible and run one uninterrupted capture.
3. Confirm progress reaches `BENCHMARK_COMPLETE 100/100`.
4. Review the CSV and, if `NO_VALID_PRICE` persists, inspect the local `ocr-debug` PNGs.
5. Compare extracted prices against timestamp-matched visible quotes before claiming exact-match accuracy.

## Build
With JDK 17 and Android SDK platform/build-tools 35 installed:
```sh
gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug
```
APK output: `app/build/outputs/apk/debug/app-debug.apk`.

## Capture implementation
MediaProjection frames are consumed through Android ImageReader. No camera permission or camera stream is requested. Phase 1 remains OCR-only: candle geometry/OHLC inference, CALL/PUT strategy decisions, alerts, and trade execution are out of scope.
