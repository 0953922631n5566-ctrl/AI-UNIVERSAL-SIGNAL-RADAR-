# Main Market Mini App — Fresh UI + Auto-start handoff (2026-11-23)

## User-approved scope
- Replace the Mini App screen design completely; do not reuse the previous visual layout.
- Opening the Telegram Mini App automatically creates a session and starts Main Market monitoring. No Start tap is required.
- Home screen shows only API connection state, EUR/USD NON-OTC M1, current price, signal lamp/state, and M1/signal countdowns.
- Put Stop/Restart, sound permission, Engine 3 diagnostics, Twelve Data EMA5/EMA20/ATR14 status, evidence/reason and API key-pool status inside the menu.
- Keep Engine 3 Trend Rider, Twelve Data native indicators, existing timing/alerts, single-symbol scope, and manual-only/no-broker-execution policy unchanged.
- Auto-start is triggered by opening the Mini App, not by Render process boot. This avoids running the market feed when nobody opens the app.

## Implementation
- Branch: feature/main-market-new-autostart-miniapp-20261123
- Updated main-market/public/signal.html with a completely new full-screen dark premium layout and a compact slide-out control/diagnostics drawer.
- Client boot calls Telegram WebApp ready/expand, creates a Mini App session, calls the existing authenticated control endpoint with action=start, then polls the existing signal endpoint.
- The drawer keeps explicit Stop/Restart. Sound remains opt-in because Android/Telegram browsers restrict autoplay; vibration is attempted on supported devices.
- Backend, signal formula, market data provider, candle processing, thresholds, timing and broker execution were not changed.
- Replaced the Mini App UI regression test to assert the new layout, auto-start flow, drawer-only diagnostics, existing native indicators and manual-only backend contract.

## Verification status
- Source changes committed on feature branch. GitHub Actions must run after PR creation.
- Required before merge: full Node test suite, inline script parse, server syntax checks, and UI DOM wiring test.
- Required after merge: Render deploy live, /health architecture check, Mini App session + automatic Start + Streaming/EMA5/EMA20/ATR14 readiness + Stop smoke test.
- User Telegram device rendering and sound permission still require device confirmation.
- No claim of predictive profitability or guaranteed trading outcomes; signal logic remains manual decision support.


## Deployment checkpoint — 2026-11-23 15:20 UTC
- PR #229 merged to main-market; merge commit: e13e58f42c089683756a0d54e06642ba2a14784e.
- GitHub Actions on final pre-merge source commit bb82d945770d7291b87f239e8ee1087ef23e0d5a: Main Market Node Tests, Mini App Checks, Main Market Checks, and Engine 3 Tests all passed.
- Render service ai-signal-radar-main-market automatically deployed merge commit e13e58f42c089683756a0d54e06642ba2a14784e; deploy dep-dc25j6vf3r2c73ep6c0g reached live.
- Read-only live verification: /health returned ok=true, Engine 3 only, native Twelve Data EMA5/EMA20/ATR14, 50+4 candle window, 10/10 Twelve Data keys available, manualOnly=true, brokerExecution=false.
- Live /signal route returned the new full-screen UI (EUR/USD, price, lamp, countdown, menu). The previous visual structure is no longer served.
- At the time of public-signal inspection, monitoring=false and API OFFLINE were expected because no Mini App browser session had yet started. Browser automation to exercise the actual auto-start flow could not launch because the external TinyFish wallet was below zero. Do not claim end-to-end auto-start/Streaming/indicator readiness or physical Telegram device verification until a real Mini App is opened and those states are confirmed.
- The implementation is deployed and CI-verified; final device-level validation remains. Keep production manual-only and do not claim predictive profitability.
