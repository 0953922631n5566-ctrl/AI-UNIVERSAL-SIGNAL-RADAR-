# Phase 1 Implementation Status

**Branch:** `feature/otc-vision-apk`  
**Scope:** isolated Android native foundation and local capture/OCR pipeline  
**Status:** source implementation committed; build and physical-device validation pending.

## Implemented in this phase

- Separate Gradle Android app under `otc-vision/`.
- Unique application ID: `com.otcvision.radar`.
- No INTERNET permission, network library, backend URL, credentials, Firebase/FCM, Telegram, Render, or Twelve Data dependency.
- Android MediaProjection user-consent flow and foreground service declaration for media projection.
- ImageReader screen-frame acquisition with a bounded capture cadence and explicit Stop/revocation cleanup.
- Two normalized ROI crops: a price-label region and a chart region.
- Price ROI preprocessing: grayscale conversion, contrast adjustment, 3x3 median denoising, and scaling.
- Bundled ML Kit Latin Text Recognition dependency.
- Conservative text parser that reports a value only when exactly one decimal-price candidate is found.
- On-screen per-frame OCR latency, frame age, candidate status, and app heap-use metrics.
- Parser unit tests and a branch-specific GitHub Actions APK build workflow.

## Verification completed

- GitHub branch comparison confirms the OTC branch is ahead of `main` by OTC project commits and has no commits behind the base at the comparison point.
- Source inspection confirms the OTC manifest does not declare INTERNET permission.
- App ID is distinct from the existing legacy Android application.
- The OTC build workflow is scoped to pushes on `feature/otc-vision-apk` and changes under `otc-vision/**`.
- No Main Market Render deployment, FCM configuration, backend request, or merge was performed.

## Not yet verified — do not treat as passed

- Gradle compilation / APK assembly: no build runner result was available at report time.
- Physical MediaProjection capture on Xiaomi 11T / Android 14.
- OCR latency distribution (median/p95) on-device.
- Exact-match price extraction accuracy against a real OTC broker screen.
- Sustained memory, battery, temperature, and thermal-throttling behavior.
- Xiaomi HyperOS background behavior and notification presentation.

## Initial benchmark results

No physical-device measurements are available yet. Therefore no numeric OCR latency or accuracy result is claimed. The application displays the required live metrics when installed and run on the Xiaomi 11T. Use the protocol in `README.md` to collect at least 100 observations and a 15-minute thermal/memory run after ROI calibration.

## Known Phase 1 limitations

- ROI coordinates are starter defaults, not broker-calibrated. Edit `RoiConfig.kt` for the actual OTC platform layout before accuracy testing.
- Candle ROI cropping is implemented, but candle body/wick detection and OHLC reconstruction are not implemented yet.
- OCR currently targets decimal-price text and may reject formats that do not match the configured token parser.
- No CALL/PUT decision logic or alerts are included in Phase 1.
- CameraX ImageAnalysis is not used because this is screen capture, not camera capture; ImageReader is the correct MediaProjection frame source.

## Next gate

Run the isolated GitHub Actions APK build, resolve any compile issues, install on the Xiaomi 11T, calibrate both ROIs, and collect real OCR latency/accuracy/thermal data before advancing to candle vision.
