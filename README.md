# AI UNIVERSAL SIGNAL RADAR — AI-10 CORE / NEXT-M1

The existing AI-10 CORE service uses **Next-M1 Forecast V2** as its active directional analysis engine. The legacy directional analysis is not used in the active decision path.

## Analysis
- 9 independent directional engines provide evidence; System 10 aggregates weighted votes.
- 54 closed M1 candles: 50 context candles + 4 latest entry candles.
- Entry dispatch is limited to the first 0–5 seconds of the target M1 candle and requires a fresh live tick.
- Independent data-quality and safety checks can veto a signal.
- Outputs: CALL / PUT / STANDBY. Evidence strength is not a win-probability estimate.
- EUR/USD is the default; the existing Mini App supports six Non-OTC pairs.
- Manual decision support only; no broker order execution.

## Existing Mini App and connection
- Keep using the existing Telegram bot Menu Button / Mini App URL.
- URL: https://ai-signal-radar-main-market.onrender.com/signal
- The existing open Mini App session flow is retained. Telegram initData verification and a new Bot Token requirement are not part of this connection flow.
- The Mini App polls the existing backend; it does not send signal messages into Telegram chats.

## Backend
- Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
- Branch: main-market
- Render service: ai-signal-radar-main-market
- Build: cd main-market && npm install
- Start: cd main-market && npm start
- Configure TWELVE_DATA_API_KEYS as a JSON array string, or use TWELVE_DATA_API_KEY_1 through TWELVE_DATA_API_KEY_10. TWELVE_DATA_API_KEY is a single-key fallback.
- Keep all API keys in Render Environment secrets only.

## Verification
The install step runs the Node test suite and syntax checks. Passing software tests does not prove predictive accuracy. Validate market-feed freshness and signals in demo/paper trading before relying on them.
