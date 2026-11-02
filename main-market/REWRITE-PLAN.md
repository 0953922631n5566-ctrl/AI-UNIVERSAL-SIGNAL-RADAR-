# MAIN MARKET v2 Rewrite Plan

Status: authorized by the user on 2026-11-02. Work is isolated on branch `rewrite/main-market-v2`; production branch `main-market` and Android/OCR branch `main` are not modified.

## Fixed product contract
- Twelve Data real-market Non-OTC only; M1 candles.
- Exactly one selected pair at a time; EUR/USD default.
- Supported selector set: AUD/USD, EUR/USD, EUR/GBP, GBP/JPY, EUR/JPY, GBP/USD.
- Mini App shows CALL / PUT / STANDBY and the reasoning directly; no signal messages to Telegram chat.
- Manual decision support only. Never place broker orders.
- REST history and live Streaming are separate capabilities. REST-only can display validated history-derived values but must remain STANDBY for directional signals until a fresh Streaming tick is confirmed.
- Missing, stale, malformed, conflicting or unsupported market data must fail closed to STANDBY.
- Preserve the 10s / 3s pre-close alert policy, directional-only sound/vibration, signal hold 40 seconds, per-candle dedupe and signal invalidation.
- No OCR, OTC, screenshot capture or Android code in this branch.

## Rewrite goals
1. Replace tightly coupled feed/server logic with explicit modules for provider access, candle normalization, market regime, evidence, decision policy, signal lifecycle and client transport.
2. Enforce single-pair scanning on the server regardless of client payload.
3. Validate candle chronology, OHLC invariants, duplicates, missing minute gaps, source timestamps and freshness before analysis.
4. Make API status, REST status, Streaming status and signal status independent and accurately represented.
5. Make every CALL/PUT auditable: regime, evidence, trigger, invalidation and expiry. Do not fabricate confidence or call a heuristic engine a trained model.
6. Keep WebSocket preferred with HTTP polling fallback and a bounded client lease so scanning stops when the Mini App is no longer present.
7. Rebuild the compact mobile UI with robust initialization, no-cache assets, accessible controls and honest device-feedback status.
8. Add unit, regression and HTTP integration tests; run CI before proposing promotion to `main-market`.

## Release policy
The rewrite branch is a candidate only. It must not replace the Render-connected `main-market` branch until tests pass and the candidate has been reviewed. No paid resources are authorized. No secrets may be written to GitHub, browser code or APKs. Live feed entitlement for each pair and physical Telegram/Xiaomi sound/vibration still require real runtime verification.
