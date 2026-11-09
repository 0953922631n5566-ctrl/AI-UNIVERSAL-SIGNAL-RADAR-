# Gemini Quota Monitor — Mini App

## Scope
- Adds observational telemetry for outbound Gemini HTTP attempts and responses.
- Exposes counters in the authenticated Telegram Mini App market snapshot.
- Shows an in-app warning for configured daily request-budget thresholds (80% and 95%) and HTTP 429 events.
- Does not alter the Gemini model, prompt, one-request-per-M1-candle policy, T-5 timing, signal decision, retry policy, or STANDBY gates.

## Accuracy boundary
- The service counts requests it actually sends to Gemini, grouped by UTC calendar day.
- Counters are held in process memory and reset on a Render service restart as well as at UTC midnight; usage percentages can therefore undercount after a restart. This first version does not claim durable historical accounting.
- Google does not provide remaining project quota through this application request path. The displayed percentage is an estimate only when the owner explicitly configures GEMINI_DAILY_REQUEST_BUDGET using the applicable Google AI Studio / Cloud quota for this project and model.
- If that environment variable is absent or invalid, the Mini App shows request counts and HTTP 429 events but does not invent a percentage.
- The in-app toast is delivered while the Telegram Mini App is open and polling. It is not a Telegram chat message or a background push when the Mini App is closed.

## Configuration
Set GEMINI_DAILY_REQUEST_BUDGET to a positive integer only after checking the actual daily request quota in the Google console. This setting is a monitoring reference; it does not change the API quota or request behavior.

## Validation
- Unit tests cover request counters, unknown budget, 80% / 95% threshold alerts, HTTP 429, and UTC day rollover.
- Review and CI are required before merge. No production deployment is included in this branch.
