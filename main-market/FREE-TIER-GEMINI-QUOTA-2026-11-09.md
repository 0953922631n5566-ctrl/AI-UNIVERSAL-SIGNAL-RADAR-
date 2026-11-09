# Gemini Free-Tier Request Controls — 2026-11-09

- Production model baseline: gemini-3.5-flash-lite.
- The production flow issues at most one Gemini HTTP attempt per eligible EUR/USD M1 candle, in the T-5 finalization window.
- PREPARE T-10 is UI-only and does not call Gemini.
- Repeated market ticks share the same in-flight/result for that M1 candle; no late request is made if the T-5 window is missed.
- HTTP 429 is not retried in the same candle. The system remains fail-closed / STANDBY when Gemini cannot return a valid decision.
- Optional GEMINI_API_KEYS key pool and GEMINI_API_KEY remain credentials only; multiple keys in the same Google Cloud project do not multiply that project's model quota.
- Gemini quota monitor counts outbound HTTP attempts by UTC calendar day and records HTTP 429 responses.
- GEMINI_DAILY_REQUEST_BUDGET is an optional owner-configured reference used only for 80% / 95% warning thresholds. It must be set from the actual applicable Google console quota. If absent, the Mini App shows request counts and 429 events without a percentage.
- The displayed count/percentage is observational telemetry, not Google's authoritative remaining-quota value.
- Mini App warnings are in-page while the Telegram Mini App is open and polling; they are not Telegram chat messages or background pushes while closed.
- Monitoring adds no Gemini calls and does not change the model, prompt, T-5 timing, signal logic, or safety gates.
