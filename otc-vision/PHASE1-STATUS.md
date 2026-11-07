# Dynamic Price Tag OCR — Implementation Status

**Branch:** `feature/otc-vision-apk`  
**Scope:** isolated Android local screen capture and dynamic orange price-tag OCR  
**Status:** source update committed; CI build and physical-device validation must be checked separately.

## Integrated
- Broad right-axis scan ROI: x=78–99.5%, y=10–90%.
- HSV orange color segmentation and connected-component anchoring to locate the moving price tag on every frame.
- Dynamic padded crop around the detected orange container.
- Fail-closed `NO_ORANGE_TAG` state when no orange component meets the tag-shape thresholds; the app does not OCR the entire axis as a fallback.
- Orange-background preprocessing to improve contrast for the price glyphs.
- Strict price token validation: 1–3 integer digits and 5–6 fractional digits.
- Multiple valid price candidates remain ambiguous; invalid/short chart decimals are ignored.
- Unit tests for 5- and 6-decimal quotes and rejection of short chart decimals.

## Not claimed yet
- CI Gradle build success for this update until the new workflow run completes.
- Exact orange hue thresholds or tag component thresholds validated against the user's broker screen.
- OCR exact-match accuracy, 100-sample accuracy, thermal stability, or sustained memory measurements on Xiaomi 11T.
- Screenshot-specific pixel calibration; the scan band is intentionally broad and normalized to display dimensions.

## Device test checklist
1. Build/install the latest artifact from this branch.
2. Confirm `PRICE_READ` follows the orange tag when it moves vertically.
3. Test tag near top, center, and bottom of the scan band.
4. Confirm no tag gives `NO_ORANGE_TAG`, not a stale/guessed price.
5. Compare every returned price against the visible broker price before reporting accuracy.
