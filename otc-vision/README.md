# OTC Vision Signal Radar — Dynamic Price Tag OCR

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

## Dynamic price-tag pipeline
- The right-axis scan ROI spans x=78–99.5% and y=10–90% of the captured screen.
- Each frame is scanned for orange pixels using HSV hue/saturation/value thresholds.
- Connected-component detection selects a compact horizontal orange container and calculates a padded bounding box around its current position.
- OCR runs only on that detected tag crop; when no orange tag is found, the frame reports `NO_ORANGE_TAG` rather than OCRing chart labels.
- Orange-tag preprocessing maps the orange container to white and contrasting glyph pixels to dark grayscale.
- Price parser accepts only 1–3 integer digits plus exactly 5–6 fractional digits (for example `1.13520` or `1.135203`). Multiple valid candidates remain `AMBIGUOUS`; no valid token is `NO_VALID_PRICE`.

## Xiaomi 11T validation
Run the app against the real broker layout and verify the tag is detected at top, middle, and bottom of the right-axis scan range. Check that `NO_ORANGE_TAG` appears when the tag is absent and that chart-axis numbers are not returned as prices. Record exact-match ground truth separately; OCR detection alone does not establish accuracy.

The code change does not claim a completed 100-sample benchmark. Accuracy, latency distribution, memory, battery, and thermal stability must be measured on the actual Xiaomi 11T with known reference prices.

## Capture implementation
MediaProjection screen frames are consumed through Android ImageReader. No camera permission or camera stream is requested. Phase 1 remains OCR-only: candle geometry/OHLC inference, CALL/PUT strategy decisions, alerts, and trade execution are out of scope.
