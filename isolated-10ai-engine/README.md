# AI-10 CORE — Standalone Engine Workspace

This directory is an isolated development copy of the ten-engine subsystem from `main-market`.

## Included source
- `src/multi-engine-dispatcher.js`: ten strategy engines, Promise.allSettled isolation, Central AI Dispatcher and Safety Noise Guard VETO.
- `src/decision-engine.js`: Original AI final safety/decision gate (copied unchanged).
- `index.js`: standalone adapter; the host supplies market context and market data.
- `test/`: isolated dispatcher regression tests.

## Engine roster
1. Trend Breakout
2. Trend Continuation
3. Pin Bar Reversal
4. Candlestick Pattern
5. Range-Bound Swing
6. Compression Squeeze
7. Momentum Divergence
8. Volume Order Flow
9. Pullback Retest
10. Safety Noise Guard (unconditional VETO authority)

## Run independently
Requires Node.js 20+; no third-party npm dependencies.

```sh
cd isolated-10ai-engine
cp .env.example .env
npm test
npm run check
```

The test workspace has no connection to Render, Twelve Data, Firebase, Android, OCR, OTC, or Telegram. It receives OHLC candles, indicator values, regime, and freshness metadata from a caller. Do not add production credentials to this workspace.

## Isolation boundary
This is a dedicated branch and a separate package directory within the existing GitHub repository, not a new GitHub repository. Production paths under `main-market/` are not modified by the extraction. Changes in this workspace do not affect the active Render service unless separately merged or deployed.

## Configuration
`.env.example` contains only local development metadata. Strategy thresholds remain source-defined to preserve parity with the production snapshot; any threshold changes should be made and tested here first, then explicitly reviewed before integration.
