# No-STANDBY Dashboard Display Change — 2026-11-09

- Scope: Main Market dashboard presentation only, on branch `main-market`.
- Dashboard renders CALL or PUT only when the backend analysis returns a qualified directional result.
- For every other backend state, the large signal panel displays a neutral dash (`—`) with explanatory text instead of the word STANDBY.
- The analysis reason, evidence, market regime, API status, and data-quality status remain visible.
- Backend decision states, the ten-engine dispatcher, Safety Noise Guard VETO, data freshness/quality locks, signal timing, FCM payloads, Android APK source, and notification behavior were not changed.
- No APK rebuild is required for this web dashboard-only change.
- Source commits: `d9f19ba8c840504f3f8a34b98ead7dd853b7b849` (app.js), `4b4b6ab75de4b9779f60b9cfb38c7fa25cbbb1a9` (index.html), `3ca9f54d3e57cf20a4ff2a3a51fb4e92dd167cd6` (styles.css).
- Pending verification: Render deployment status, live dashboard rendering, and user device/browser retest.
- Important: hiding STANDBY is not equivalent to forcing CALL/PUT. No directional signal is displayed until the existing analysis pipeline qualifies one.
