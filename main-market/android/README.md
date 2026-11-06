# Kawasaki Signal Radar Android APK

- Native Android WebView shell for the Main Market client.
- Loads only the HTTPS Main Market backend origin.
- The device credential is encrypted with an AES-GCM key held by Android Keystore; it is not compiled into the APK.
- On first launch, enter the device connection credential supplied by the project operator.
- Backend sessions are short-lived Bearer tokens; the credential is sent only over HTTPS.
- Build: `gradle assembleDebug` from this directory (JDK 17, Android SDK 35).
