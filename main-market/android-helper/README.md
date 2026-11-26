# IQ Option Screen Bridge (Android prototype)

This is an isolated, read-only prototype for mirroring the visible EUR/USD Digital chart from the user's Android display into the Main Market Mini App.

## Safety and scope
- Main Market only: EUR/USD, non-OTC.
- Read-only capture and display. No broker order placement, clicks, account automation, or trade execution.
- Never request, store, or transmit IQ Option passwords, cookies, session tokens, or account credentials.
- Android MediaProjection must be explicitly approved by the device user each time Android requires it.
- Capture is user-controlled and should be limited to the chart region where practical.
- Do not merge this prototype into `main-market` or deploy it to production until the user has tested and approved it.

## Important accuracy limitation
A screen mirror can reproduce the visible chart pixels, but OCR or pixel analysis cannot guarantee exact OHLC/tick reconstruction. Screen refresh rate, compression, chart scaling, overlays, and OCR mistakes can all introduce errors. The prototype must label captured data as screen-derived and must not present it as exchange/broker-native OHLC.

## Proposed flow
1. User opens the Android helper and explicitly starts screen capture.
2. Android MediaProjection captures the display while IQ Option is visible (split-screen is the practical way to view IQ Option and the Telegram Mini App together).
3. The helper crops/encodes the chart region and sends frames over HTTPS to a dedicated authenticated, read-only bridge endpoint.
4. The Mini App displays the received chart frame as a mirror. Any OCR-derived price/time values are optional diagnostics, not authoritative candles.
5. User can stop capture immediately from the helper/Android foreground notification.

## Implementation stages
- Stage 1: Android MediaProjection permission flow and local preview.
- Stage 2: HTTPS upload with a short-lived pairing secret; no broker credentials.
- Stage 3: read-only Mini App image feed, clearly marked "IQ OPTION SCREEN MIRROR".
- Stage 4: device testing on Xiaomi 11T / Android 14; compare timestamps and frame gaps.
- Stage 5: only after successful tests, consider optional OCR diagnostics.

## Not yet production-ready
This branch is a prototype plan. It is not connected to the Render service, has not been built into an APK, and has not been validated on the user's device.
