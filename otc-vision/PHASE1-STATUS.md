# OTC Vision OCR — Fine-Tuning & Benchmark Status

**Branch:** `feature/otc-vision-apk`  
**Scope:** isolated Android local screen capture, orange-tag OCR, and local benchmark  
**Status:** CI build and parser unit tests passed; Xiaomi 11T 100-sample field benchmark pending.

## Integrated
- Dynamic orange-tag detection and padded ROI anchoring on the right price axis.
- Orange-aware grayscale inversion, contrast stretch, local adaptive threshold using an integral image, and minimum crop upscaling for small glyphs.
- Strict 1–3 integer digits plus 5–6 fractional digits; includes `1.135475`.
- Parser unit tests cover 5/6 decimals, comma separator, short decimals, too-long decimals, ambiguous matches, and unrelated text.
- Capture automatically logs 100 consecutive processed outcomes (price read, no tag, or OCR failure) to a CSV in the app-specific Documents directory (or internal app files if external app storage is unavailable).
- Per-sample telemetry: extraction status, parsed price, OCR/frame latency, heap, Android thermal status, and battery temperature if exposed.
- Completion summary reports extraction rate, mean/max OCR latency, peak heap, max thermal status, and max battery temperature.

## CI build verification — 2026-11-07
- GitHub Actions run #30 / ID `42337050038` completed successfully.
- Source commit built: `c0c9a92452c146efa1aeff4249b5ed8191761e16`.
- Parser unit tests: **8 passed, 0 failed (100%)**.
- APK artifact: `otc-vision-finetuned-debug-apk`, artifact ID `13560336155`, 22,435,944-byte ZIP; expires 2026-11-21.
- APK size: 46,421,384 bytes.
- APK SHA-256: `df69199c119119cf5c10b14830af3dc4bba10ca1a0adfad4df201107534e5398` (independently matched the checksum inside the downloaded artifact).
- Build run: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-/actions/runs/42337050038

## Benchmark interpretation
- Extraction rate is not exact-match accuracy.
- CSV `exact_match` remains blank until a timestamp-matched ground-truth quote is supplied for each frame.
- Battery temperature is not SoC temperature; Android thermal status is a coarse platform indicator.
- No 100-sample Xiaomi 11T measurement is claimed until the updated APK has run on-device for the full sequence and its CSV has been reviewed.

## Device validation
1. Install the newly built APK on Xiaomi 11T.
2. Keep the orange quote tag visible and run one uninterrupted capture.
3. Confirm progress reaches `benchmark 100/100` and then `BENCHMARK_COMPLETE 100/100`.
4. Export `files/benchmark/ocr-100-<timestamp>.csv` and compare all 100 readings to visible reference prices.
5. Report extraction rate and exact-match accuracy separately; inspect thermal and battery-temperature columns.

## Isolation
No network, backend, Render, Twelve Data, Firebase, FCM, Telegram, broker execution, or Main Market changes.
