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
