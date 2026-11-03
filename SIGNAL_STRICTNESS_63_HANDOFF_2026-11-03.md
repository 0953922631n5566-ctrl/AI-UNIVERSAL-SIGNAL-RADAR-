# Signal strictness set to 63% — 2026-11-03

Project: AI Universal Signal Radar — Main Market / NON-OTC EUR/USD M1

## Change
- Default signal-filter strictness is now **63%** (`SIGNAL_STRICTNESS=63`).
- This is a tuning level for how demanding RSI momentum confirmation is. It is **not** a 63% win probability or accuracy claim.
- At 63%, RSI confirmation is modestly relaxed from the previous baseline:
  - CALL: RSI14 >= 49.3
  - PUT: RSI14 <= 50.7
- EMA5/EMA20 trend alignment and price-side confirmation remain mandatory for trend-following signals.
- Breakouts still must agree with EMA direction and RSI momentum.
- Existing sideway exception remains limited to its support/resistance edge rules (RSI <=45 for CALL, >=55 for PUT).
- Missing/stale REST history fallback behavior, final 5-second M1 publication window, and 35-second hold are unchanged.
- The effective value is clamped to 0–100. Render can override the default with environment variable SIGNAL_STRICTNESS; if unset, it uses 63.

## How to tune later
- Lower SIGNAL_STRICTNESS to relax RSI confirmation and allow more candidates, while retaining EMA trend alignment.
- Raise it to demand stronger RSI confirmation and reduce candidates.
- Suggested field-test steps: change in 3–5 point increments, record signal count and outcomes over a meaningful sample, and do not infer win rate from the strictness number.

## Validation
- Added a unit test asserting default 63 and RSI threshold 49.3.
- Run npm test / GitHub Actions before merge and deployment.