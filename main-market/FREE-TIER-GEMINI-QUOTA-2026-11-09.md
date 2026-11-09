# Gemini Free-Tier Request Controls — 2026-11-09

- Gemini HTTP requests are issued only during the active M1 T-10 to T-5 window.
- The result is retained for that live candle and reused at T-5; repeated market ticks do not trigger repeated API requests.
- A new live M1 candle opens a new request window. If the window is missed, the service stays STANDBY rather than making a late request.
- HTTP 429 transient rate limits use at most two retries with exponential backoff and jitter. Daily-quota exhaustion is not retried.
- Optional key pool: set `GEMINI_API_KEYS` to comma-, semicolon-, or newline-separated API keys. The existing `GEMINI_API_KEY` remains supported.
- Key rotation is best-effort failover. Google applies Gemini RPM/TPM/RPD limits per Google Cloud project, not per API key. Multiple keys belonging to the same project do not increase that project's quota; separate projects have separate quota buckets subject to Google's terms and account limits.
- No Pay-as-you-go billing or automatic billing changes are performed.
- The existing source-quality, T-5 fresh-stream, signal-release and Gemini-only decision gates remain unchanged.
