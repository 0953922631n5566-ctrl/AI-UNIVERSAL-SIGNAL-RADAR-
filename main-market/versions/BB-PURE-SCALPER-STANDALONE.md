# BB PURE SCALPER — STANDALONE

- Status: isolated feature implementation; not production-enabled.
- Branch: `feature/bb-pure-scalper-standalone-20261116`.
- Base: `main-market`; the V1 baseline remains unchanged.
- Bollinger Bands: 20-period SMA, 2 standard deviations.
- Entry styles: immediate closed-candle outer-band rejection, or next-closed-candle confirmation by breaking the rejection candle high/low.
- Release lifecycle: separate BB T-5 finalization using a fresh Streaming tick, target next M1 candle, 30-second display hold, and separate sound/vibration alert ID in the existing Mini App.
- Pressure: candle body direction, close location, and upper/lower wick proportions yield separate buying/selling pressure diagnostics.
- False-signal guard: requires band touch, close back inside, rejection wick and directional pressure; blocks counter-trend reversals during detected expanding-band walk.
- Data: closed M1 OHLC only; ignores live candles; minimum 22 valid candles.
- Isolation: no import or call into V1 scoring; no changes to V1 thresholds, Twelve Data transport, Mini App auth, V1 signal timing or V1 alerts; BB has its own isolated T-5 release and 30-second alert lifecycle.
- Validation: initial unit tests cover bad/insufficient data, touch-only rejection, pressure diagnostics and exclusion of live candle. Full replay, integration tests, CI, PR review and paper testing remain required before production activation.
- Manual decision support only; no accuracy or profitability claim.
