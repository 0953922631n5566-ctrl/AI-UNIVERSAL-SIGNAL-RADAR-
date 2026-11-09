# AI UNIVERSAL SIGNAL RADAR — AI-10 CORE / NEXT-M1

The existing AI-10 CORE service now uses **Next-M1 Forecast V2** as its live decision engine. The legacy directional analysis is not used in the active decision path.

## Analysis
- 9 independent directional engines provide evidence; System 10 aggregates weighted votes.
- 54 closed M1 candles: 50 context candles + 4 latest entry candles.
- Entry dispatch is limited to the first 0–5 seconds of the target M1 candle and requires a fresh live tick.
- Independent data-quality and safety checks can veto a signal.
- Outputs: CALL / PUT / STANDBY. Evidence strength is not a win-probability estimate.
- EUR/USD is the default; the Mini App supports six Non-OTC pairs.
- Manual decision support only; no broker order execution.

## Existing Telegram Mini App
- Open the existing bot's Menu Button / Mini App URL; do not use a new bot or a separate service.
- URL: https://ai-signal-radar-main-market.onrender.com/signal
- The Mini App verifies Telegram WebApp `initData` server-side with `TELEGRAM_BOT_TOKEN`.
- The bot token must be configured as a Render secret. Never commit it or paste it into source code.
- Optional `TELEGRAM_ALLOWED_USER_IDS` restricts access to specific Telegram accounts.
- The app polls the backend; it does not send signal messages into Telegram chats.

## Backend
- Repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`
- Branch: `main-market`
- Render service: `ai-signal-radar-main-market`
- Build: `cd main-market && npm install`
- Start: `cd main-market && npm start`
- Configure `TWELVE_DATA_API_KEYS` as a JSON array string, or use `TWELVE_DATA_API_KEY_1` through `TWELVE_DATA_API_KEY_10`. `TWELVE_DATA_API_KEY` is a single-key fallback.
- Keep all API keys and Telegram credentials in Render Environment secrets only.

## Verification
The install step runs the Node test suite and syntax checks. Passing software tests does not prove predictive accuracy. Validate market-feed freshness and signals in demo/paper trading before relying on them.
