import { createRequire } from "node:module";
import { MIN_CLOSED_CANDLES, CONTEXT_CANDLES, ENTRY_CANDLES, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS } from "./config.js";

const require = createRequire(import.meta.url);
const { analyzeMarketMulti } = require("../original-ai/engine/analyze-market.js");

function sourceGate(candles, options) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const closed = Array.isArray(candles)
    ? candles.filter(c => c && c.live !== true && Number.isFinite(c.epoch) &&
        c.epoch < Math.floor(now / 60000) * 60)
    : [];
  const last = closed.at(-1) || null;
  const ageSeconds = last ? Math.max(0, now / 1000 - (last.epoch + 60)) : Infinity;
  const stream = Number.isFinite(options.tickAgeSeconds) &&
    options.tickAgeSeconds >= 0 && options.tickAgeSeconds <= MAX_STREAM_AGE_SECONDS;
  const rest = options.allowRestFallback === true && ageSeconds <= MAX_CANDLE_AGE_SECONDS;
  const enough = closed.length >= MIN_CLOSED_CANDLES;
  const window = closed.slice(-MIN_CLOSED_CANDLES);
  const validOHLC = enough && window.every(c =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.close > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low
  );
  const ordered = window.every((c, i) => i === 0 || c.epoch > window[i - 1].epoch);
  const reason = !enough ? `Insufficient closed M1 candles (${closed.length}/${MIN_CLOSED_CANDLES})`
    : !validOHLC ? "Invalid OHLC candle data"
    : !ordered ? "Candle timestamps are not strictly increasing"
    : ageSeconds > MAX_CANDLE_AGE_SECONDS ? "Latest closed candle is stale"
    : !stream && !rest ? "No fresh Streaming tick or permitted fresh REST fallback"
    : null;
  return {
    ready: !reason, reason, mode: stream ? "STREAMING" : rest ? "REST_FALLBACK" : "UNAVAILABLE",
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    lastCandleEpoch: last?.epoch ?? null, closed
  };
}

/**
 * The sole directional pipeline is Original AI:
 * source/data-quality gate -> market perception -> regime/strategy -> decision engine.
 * Historical analogue workers are intentionally not imported, started, awaited, or consulted.
 */
export async function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  if (!gate.ready) {
    return {
      signal: "STANDBY", reason: gate.reason, regime: "UNCLEAR", score: 0,
      strategy: "NONE", indicators: null, livePriceReady: false,
      lastCandleEpoch: gate.lastCandleEpoch, dataMode: gate.mode,
      ageSeconds: gate.ageSeconds, closedCandleCount: gate.closed.length,
      requiredCandles: MIN_CLOSED_CANDLES,
      analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES }
    };
  }

  const decision = await analyzeMarketMulti(gate.closed.slice(-MIN_CLOSED_CANDLES), {
    now: options.now, tickAgeSeconds: options.tickAgeSeconds,
    allowRestFallback: gate.mode === "REST_FALLBACK", ageSeconds: gate.ageSeconds
  });
  return {
    ...decision,
    lastCandleEpoch: gate.lastCandleEpoch,
    dataMode: gate.mode,
    ageSeconds: gate.ageSeconds,
    livePriceReady: true,
    closedCandleCount: gate.closed.length,
    requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES }
  };
}
