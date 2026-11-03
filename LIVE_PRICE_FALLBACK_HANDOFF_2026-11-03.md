> **DEPRECATED — HISTORICAL NOTES ONLY:** This document describes an older architecture and is not the active system specification. The current branch uses Android full-screen raw OCR → `POST /api/ocr/price` → server-side price extraction, M1 6 closed candles, EMA(3/5), RSI(5), MACD(3/5/2). No Twelve Data, external market-price API, synthetic prices, or Render deployment is permitted before real device log verification.

# Live-price fallback handoff — 2026-11-03

Project: AI Universal Signal Radar — Main Market / NON-OTC
Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
Render service: ai-universal-signal-radar-main (srv-dbkaoo0473hc7384tmog)
Production URL: https://ai-universal-signal-radar-main.onrender.com/

## User request
Preserve the existing signal engine and Telegram Mini App. Add a price-direction fallback for missing API candle history without replacing the full system.

## Implementation
- The signal processor is in live-engine.js, initialized by server.js. server.js and the overall app structure were preserved.
- If closed REST history is unavailable (fewer than 20 closed candles, invalid last-candle time, or last completed candle older than 180 seconds), the live engine can use two consecutive valid Twelve Data WebSocket quotes:
  - current price > previous price: CALL
  - current price < previous price: PUT
  - equal/invalid prices, previous quote older than 30 seconds, or unavailable live stream: WAIT/STANDBY; never fabricate a price or direction.
- A valid/fresh main strategy WAIT is not overridden by fallback.
- Existing final 5-second M1 publication window and 35-second signal hold are retained.
- Mini App was minimally updated to accept the LIVE_PRICE_DIRECTION fallback when REST is unavailable but the WebSocket stream and quote remain fresh. Layout is unchanged.

## Pull requests and tests
- PR #18 merged: add live-price direction fallback and Mini App support. GitHub Actions run 41634435677 passed.
- PR #19 merged: apply fallback to stale REST history. GitHub Actions run 41634683587 passed.
- PR #20 merged: fix declaration of historyUnavailable. GitHub Actions run 41634891594 passed.

## Render deployment
- First fallback deploy dep-dbkt1rl9el5s73eur980 reached LIVE on commit 2c1cda928f644651bfd7318afdde9137b94ddeb0.
- Follow-up deploy dep-dbkt2k49v7es73d1l95g failed at runtime because historyUnavailable was not declared. This was found in Render logs; it is not the final deployment.
- PR #20 fixed the declaration.
- Final deploy dep-dbkt3arbc2fs7389oefg is LIVE on commit 631dd94c2cf366f426de66853a5534c9aaf93d1f.
- Final runtime logs confirm server listening on port 10000, startup history warm-up connected with 200 candles, and Render reports the service live. No further ReferenceError appeared in captured post-deploy logs.
- /health and /api/live were not independently fetched through the available verification path; do not claim a post-deploy CALL/PUT has been observed.

## Still needs physical-device verification
- Open the Telegram Mini App and start scanning.
- Verify actual sound, vibration, final-five-second timing, and 35-second hold on Xiaomi 11T / Android 14.
- No fallback can guarantee a direction if fresh WebSocket quotes are unavailable or consecutive prices are equal. Do not substitute demo prices or fabricated CALL/PUT signals.
