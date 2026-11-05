import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES } from "../src/config.js";
import { analyzeMarket } from "../src/analyzer.js";

const require = createRequire(import.meta.url);
const { buildMarketContext } = require("../original-ai/scanner/market-context.js");
const { routeStrategy } = require("../original-ai/engine/strategy-router.js");
const { decide: decideOriginal } = require("../original-ai/engine/decision-engine-original.js");

function originalDecision(candles) {
  const context = buildMarketContext(candles);
  const candidate = routeStrategy(context);
  return decideOriginal(context, candidate);
}

function history(count = 220, variant = 0) {
  let price = 1.08;
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  return Array.from({ length: count }, (_, i) => {
    const delta = Math.sin(i * 1.7 + variant) * 0.00005 + Math.sin(i * 0.37) * 0.000025;
    const open = price, close = price + delta, epoch = start + i * 60;
    price = close;
    return { time: new Date(epoch * 1000).toISOString(), epoch, open,
      high: Math.max(open, close) + 0.000015, low: Math.min(open, close) - 0.000015,
      close, live: false };
  });
}

test("Original AI data warm-up is 200 closed M1 candles with live-candle headroom", () => {
  assert.equal(MIN_CLOSED_CANDLES, 200);
  assert.equal(HISTORY_CANDLES, 200);
  assert.equal(MAX_CANDLES, 220);
});

test("Original AI alone decides CALL/PUT; historical simulation runs in parallel and reaches its Decision Engine", () => {
  const candles = history();
  const options = { now: Date.now(), tickAgeSeconds: 0 };
  const original = originalDecision(candles.slice(-MIN_CLOSED_CANDLES));
  const result = analyzeMarket(candles, options);
  assert.equal(result.signal, original.signal);
  assert.equal(result.regime, original.regime);
  assert.equal(result.assistant.role, "ADVISORY_ONLY");
  assert.ok(["READY", "LIMITED_SAMPLE"].includes(result.assistant.status));
  assert.ok(["AGREES", "CONFLICTS", "NO_COMPARISON"].includes(result.assistant.alignment));
  assert.ok(["PARALLEL_WORKER_THREAD", "CACHED_WORKER_RESULT"].includes(result.assistant.executionMode));
  assert.equal(result.assistantAlignment, result.assistant.alignment);
  assert.equal(result.assistantHistoricalDirection, result.assistant.historicalDirection);
  assert.equal("confidence" in result.assistant, false);
});

test("Historical assistant never manufactures an order when its data source gate fails", () => {
  const result = analyzeMarket(history(), { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.livePriceReady, false);
  assert.equal(result.assistant.role, "ADVISORY_ONLY");
  assert.equal(result.assistant.status, "UNAVAILABLE");
  assert.equal(result.assistant.executionMode, "SOURCE_BLOCKED");
});

test("REST fallback can supply data only when explicitly enabled and fresh", () => {
  const candles = history();
  const allowed = analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: true });
  assert.equal(allowed.dataMode, "REST_FALLBACK");
  assert.equal(allowed.livePriceReady, true);
  const blocked = analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false });
  assert.equal(blocked.signal, "STANDBY");
});

test("Current live candle is excluded from Original AI closed-candle window", () => {
  const candles = history();
  const liveEpoch = Math.floor(Date.now() / 60000) * 60;
  candles.push({ ...candles.at(-1), epoch: liveEpoch, live: true });
  const result = analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(result.closedCandleCount, 220);
  assert.equal(result.lastCandleEpoch, candles.at(-2).epoch);
});

test("Malformed and stale source data fails closed", () => {
  const malformed = history();
  malformed.at(-1).high = malformed.at(-1).low - 0.1;
  assert.equal(analyzeMarket(malformed, { tickAgeSeconds: 0 }).signal, "STANDBY");
  const stale = history();
  stale.forEach(c => { c.epoch -= 600; });
  assert.equal(analyzeMarket(stale, { now: Date.now(), tickAgeSeconds: 0 }).signal, "STANDBY");
});

test("Historical assistant cache is invalidated when candle history changes", () => {
  const a = analyzeMarket(history(220, 0), { tickAgeSeconds: 0 });
  const b = analyzeMarket(history(220, 1), { tickAgeSeconds: 0 });
  assert.ok(["PARALLEL_WORKER_THREAD", "CACHED_WORKER_RESULT"].includes(a.assistant.executionMode));
  assert.equal(b.assistant.executionMode, "PARALLEL_WORKER_THREAD");
});
