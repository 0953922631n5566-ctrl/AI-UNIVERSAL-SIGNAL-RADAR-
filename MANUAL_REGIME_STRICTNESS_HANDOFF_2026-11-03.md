> **DEPRECATED — HISTORICAL NOTES ONLY:** This document describes an older architecture and is not the active system specification. The current branch uses Android full-screen raw OCR → `POST /api/ocr/price` → server-side price extraction, M1 6 closed candles, EMA(3/5), RSI(5), MACD(3/5/2). No Twelve Data, external market-price API, synthetic prices, or Render deployment is permitted before real device log verification.

# Manual Market Regime & Signal Strictness Handoff — 2026-11-03

## Scope
Added operator controls to the existing Main Market NON-OTC EUR/USD M1 Mini App. Existing Twelve Data REST/WebSocket connections, manual-only operation, final 5-second signal window, 35-second hold, and sound/vibration alert implementation are retained.

## Mini App controls
- Analysis mode selector: AUTO (default), UPTREND, DOWNTREND, SIDEWAY.
- Signal strictness slider: 55–100%, default 55%.
- Settings are saved in browser localStorage and sent to server through POST /api/settings.
- GET /api/settings returns active server preferences.
- Changing mode/strictness clears a currently held signal so the previous strategy result is not carried into the new settings.
- Server suppresses a second signal in the same M1 minute after a settings change; the new configuration can issue a signal from the next minute.

## Mode behavior
- AUTO: preserves existing multi-regime decision path.
- UPTREND: only aligned bullish trend/breakout CALL candidates are eligible. Bearish or sideways conditions do not produce a PUT; they remain WAIT/STANDBY.
- DOWNTREND: only aligned bearish trend/breakout PUT candidates are eligible. Bullish or sideways conditions remain WAIT/STANDBY.
- SIDEWAY: only the existing range-edge support-bounce/resistance-drop rules are eligible. If the current market does not satisfy the sideway classifier, remain WAIT/STANDBY.
- Manual modes require fresh closed-candle history; they deliberately do not use the two-tick live-price fallback because that fallback cannot verify the selected regime.
- The market's detected trend remains separately shown in the Mini App stats; selected analysis mode is shown in the forecast readout.

## Strictness behavior
- UI default is 55%, range 55–100%.
- It adjusts RSI confirmation threshold from 50.00 at 55% to 56.75 at 100% (bearish threshold is symmetric: 50.00 down to 43.25).
- This is a filter-strength setting, NOT a win probability, forecast accuracy, or confidence percentage.
- Existing environment default constant remains for backward-compatible callers/tests; the live engine passes the current UI preference into each analysis.

## API
- GET /api/settings
- POST /api/settings with JSON: { "mode": "auto|uptrend|downtrend|sideway", "strictness": 55..100 }

## Verification still required
- GitHub Actions test run after PR creation.
- Render deployment status after merge.
- Physical Telegram Mini App test on Xiaomi 11T: mode persistence, slider persistence, signal behavior, audio/vibration, and confirmation that changing settings does not duplicate alerts.
- No profitability or win-rate claim is made. Validate on demo/paper observations before relying on signals.

## Safety
Manual entry only. No broker order placement was added. Missing/stale market data must continue to produce WAIT/STANDBY.
