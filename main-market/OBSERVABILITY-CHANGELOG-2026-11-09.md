# Gemini Primary Analyzer Observability Update

- Gemini logs: `[gemini] request_started`, `[gemini] response_success`, `[gemini] request_failed`, and `[gemini] final_decision`.
- Each Gemini event carries a request key (symbol + closed M1 candle epoch), model, timeframe, duration where applicable, HTTP status or error, and final signal.
- Timing logs: `[timing] T-10 PREPARE window entered` and `[timing] T-5 FINALIZE window entered`, deduplicated per source candle. T-5 logs include candidate signal, tick age, eligibility, and gate reason.
- PREPARE remains non-directional. Mini App PREPARE sound/vibration follows backend `preAlertStatus=PREPARE_ALERT`; directional alert is emitted when T-5 CALL/PUT is finalized. Dashboard countdown sound threshold is aligned from T-3 to T-5.
- No change to Gemini-only decision authority, data-quality guards, fresh-tick requirement, or STANDBY behavior.
