# Main Market Streaming Reconnect — 2026-11-11

## Scope
- Repair only selected-pair Twelve Data WebSocket reliability.
- Retry a selected stream when its first live tick does not arrive within 25 seconds.
- Retry when an established stream stops updating beyond the existing 25-second freshness limit.
- Rotate to the next available Twelve Data API key on stalled feeds or provider subscription errors.
- Emit structured logs for socket open, subscription acceptance/rejection, and first live tick.

## Preserved
- Analyzer implementation, scoring weights, thresholds, and CALL/PUT/STANDBY decisions.
- Closed-candle history and M1 timing gates (T-10/T-5) and 30-second signal hold.
- REST fallback is display/data context only; fresh Streaming remains required for signal finalization.
- Telegram Mini App authentication/session, UI, selected six-symbol list, and API pool configuration.

## Verification
- Added unit tests for first-tick timeout, stale-tick recovery, and healthy/non-selected stream behavior.
- Runtime availability for each pair still depends on Twelve Data account entitlements and provider acceptance; deployment logs must confirm first live tick per pair.
