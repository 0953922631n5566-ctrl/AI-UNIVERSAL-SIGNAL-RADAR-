# Main Market API Pool + 100-Candle Data Upgrade — 2026-11-10

## Scope
- Main Market only: EUR/USD default, selectable Non-OTC M1 symbols unchanged.
- Telegram Mini App frontend, UI, auth/session, connection protocol, start/stop controls, countdown, and alert presentation are untouched.
- Scoring threshold 65/45, 50-context + 4-entry analysis window, signal timing, and 30-second hold are unchanged.

## Data and quota policy
- REST history request asks Twelve Data for 100 closed M1 candles.
- The analyzer's minimum/decision window remains 54 closed candles (50 context + 4 latest entry candles). The additional history is retained as buffer/context data and does not silently change the scoring formula.
- Candle buffer is 110 entries so a live/in-progress candle does not evict the 100 closed historical candles.
- REST resync remains 180 seconds for the single selected pair: approximately 480 one-symbol time_series credits per 24 hours at one credit per request.
- Live price remains a single Twelve Data WebSocket subscription for the selected pair. A local watchdog checks feed freshness every 5 seconds; this is not a REST request and does not consume API credits per tick.
- REST requests rotate round-robin through healthy configured API keys; failures/quota/auth errors still trigger cooldown and failover. WebSocket uses the active healthy key and rotates on subscription/feed failures.
- Ten configured keys do not automatically mean ten times the quota. If the keys share one Twelve Data account/plan, the account-level quota may be shared. The 480/day REST budget is intentionally conservative relative to the previously discussed Basic 800/day plan, but actual account entitlement and current key count must be confirmed by live /health and Twelve Data account usage.

## Runtime verification fields
- /health configuration exposes historyCandles, livePriceCheckSeconds, restRefreshSeconds, estimatedRestCreditsPerDay, and REST key rotation mode.
- API pool status exposes configured/available key counts, active key number, and next REST rotation key number without exposing credential material.

## Validation still required after merge/deploy
- Build-time npm test and JavaScript syntax checks.
- Render deploy reaches live.
- /health confirms configured API key count and the new cadence/history values.
- /api/public/signal or Render logs confirm REST returns up to 100 closed candles and live tick age remains fresh.
- User-side Telegram Mini App retest is still required; frontend was intentionally not changed.
- No claim of predictive accuracy or production trading edge is made by increasing candle history.