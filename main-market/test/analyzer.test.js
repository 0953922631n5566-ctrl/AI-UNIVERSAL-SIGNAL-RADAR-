import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES } from "../src/config.js";
import { analyzeMarket } from "../src/analyzer.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { analyzeMarket: analyzeOriginal, prepareMarket, finalizeMarket } =
  require("../original-ai/engine/analyze-market.js");
const { decide, MIN_SCORE, MIN_TREND_ADX, hasStrongTrendMomentum } =
  require("../original-ai/engine/decision-engine.js");

function history(count = 220) {
  let price = 1.08;
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  return Array.from({ length: count }, (_, i) => {
    const delta = Math.sin(i * 1.7) * 0.00005 + Math.sin(i * 0.37) * 0.000025;
    const open = price, close = price + delta, epoch = start + i * 60;
    price = close;
    return { time: new Date(epoch * 1000).toISOString(), epoch, open,
      high: Math.max(open, close) + 0.000015, low: Math.min(open, close) - 0.000015,
      close, live: false };
  });
}

test("System-10 aggregate passes through without legacy trend and sideways re-vetoes", () => {
  const candidate = {
    signal: "CALL", score: 40, confidence: 20, strategy: "AI10_DIRECTION_AGGREGATOR",
    reason: "Nine-system weighted vote selected CALL",
    aggregation: { decisionBy: "SYSTEM_10", callScore: 80, putScore: 30 },
    safetyGuard: { validity: true, reason: "PASS: safety checks passed" }
  };
  const result = decide({
    regime: "SIDEWAY", higherTimeframe: { direction: "PUT" },
    indicators: { adx: 5, volatilityRatio: 2.5, rsi: 20 }
  }, candidate);
  assert.equal(result.signal, "CALL");
  assert.equal(result.strategy, "AI10_DIRECTION_AGGREGATOR");
});

test("Original AI data warm-up remains 200 closed M1 candles", () => {
  assert.equal(MIN_CLOSED_CANDLES, 200);
  assert.equal(HISTORY_CANDLES, 200);
  assert.equal(MAX_CANDLES, 220);
});

test("Live analyzer routes through async ten-engine dispatcher", async () => {
  const candles = history();
  const routed = await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: 0 });
  assert.ok(["CALL", "PUT", "STANDBY"].includes(routed.signal));
  assert.ok(routed.engineResults);
  assert.equal(routed.engineResults.length, 9);
  assert.equal(routed.engineSummary.directionalEngines, 9);
  assert.equal(routed.engineSummary.aggregator, 1);
  assert.equal(routed.engineSummary.total, 10);
  assert.equal(routed.engineSummary.failed, 0);
  assert.equal(routed.livePriceReady, true);
  assert.equal(routed.dataMode, "STREAMING");
  assert.ok(routed.higherTimeframe);
  assert.equal("assistant" in routed, false);
  assert.equal("historicalDirection" in routed, false);
});

test("Original engine API ignores any legacy assistant argument", () => {
  const candles = history().slice(-MIN_CLOSED_CANDLES);
  const direct = analyzeOriginal(candles);
  const legacyArgument = analyzeOriginal(candles, {
    decisionReady: true, historicalDirection: "PUT", directionalSharePercent: 99, analogueCount: 500
  });
  assert.deepEqual(legacyArgument, direct);
  assert.deepEqual(finalizeMarket(prepareMarket(candles)), direct);
});

test("Decision engine uses strict score and ADX thresholds with M1 momentum during M5 transition", () => {
  assert.equal(MIN_SCORE, 45);
  assert.equal(MIN_TREND_ADX, 14);
  const base = {
    regime: "UPTREND",
    higherTimeframe: { direction: "CALL" },
    indicators: { adx: 14, plusDI: 30, minusDI: 12, macdHistogram: 0.0001,
      rsi: 55, volatilityRatio: 1, nearResistance: false, nearSupport: false }
  };
  const candidate = { signal: "CALL", score: 45, strategy: "UPTREND", reason: "valid" };
  assert.equal(decide(base, candidate).signal, "CALL");
  assert.equal(decide(base, { ...candidate, score: 44 }).signal, "STANDBY");
  assert.equal(hasStrongTrendMomentum(base, candidate), true);
  assert.equal(hasStrongTrendMomentum({ ...base, higherTimeframe: { direction: "PUT" } }, candidate), true);
  assert.equal(decide({ ...base, higherTimeframe: { direction: "UNCLEAR" } }, candidate).signal, "CALL");
  const bearish = { regime: "DOWNTREND", higherTimeframe: { direction: "UNCLEAR" }, indicators: {
    adx: 25, plusDI: 10, minusDI: 30, macdHistogram: -0.0001, rsi: 40,
    volatilityRatio: 1, nearResistance: false, nearSupport: false
  }};
  assert.equal(decide(bearish, { signal: "PUT", score: 65, strategy: "DOWNTREND" }).signal, "PUT");
  assert.equal(decide({ ...base, indicators: { ...base.indicators, adx: 13.99 } }, candidate).signal, "STANDBY");
});

test("Sideways high-conviction single-engine candidate passes only with full independent confirmation", () => {
  const ctx = { regime: "SIDEWAY", higherTimeframe: { direction: "CALL" }, indicators: {
    emaBullishAlignment: 3, emaBearishAlignment: 0, plusDI: 22, minusDI: 14,
    macdHistogram: 0.0001, rsi: 54, volatilityRatio: 1
  }};
  const engineResults = [
    { engine: "pullback_retest", direction: "CALL", validity: true },
    { engine: "safety_noise_guard", direction: "NO_SIGNAL", validity: true, reason: "PASS: safe" }
  ];
  const candidate = { signal: "CALL", score: 66, strategy: "UPTREND", engineResults };
  assert.equal(decide(ctx, candidate).signal, "CALL");
  assert.equal(decide({ ...ctx, indicators: { ...ctx.indicators, macdHistogram: -0.0001 } }, candidate).signal, "STANDBY");
  assert.equal(decide({ ...ctx, higherTimeframe: { direction: "PUT" } }, candidate).signal, "STANDBY");
  assert.equal(decide(ctx, { ...candidate, score: 64 }).signal, "STANDBY");
});

test("Sideways market is always blocked, even with an attractive candidate score", () => {
  const ctx = { regime: "SIDEWAY", higherTimeframe: { direction: "CALL" },
    indicators: { volatilityRatio: 1, nearSupport: true, nearResistance: false } };
  assert.equal(decide(ctx, { signal: "CALL", score: 100, strategy: "SIDEWAY" }).signal, "STANDBY");
});

test("Volatility safety gate still blocks extreme and unsupported high volatility", () => {
  const candidate = { signal: "CALL", score: 100, strategy: "UPTREND", reason: "candidate" };
  const ctx = { regime: "UPTREND", higherTimeframe: { direction: "CALL" },
    indicators: { adx: 30, plusDI: 30, minusDI: 10, macdHistogram: 0.0001,
      rsi: 55, volatilityRatio: 2.3, nearResistance: false, nearSupport: false } };
  assert.equal(decide(ctx, candidate).signal, "CALL");
  assert.equal(decide({ ...ctx, indicators: { ...ctx.indicators, volatilityRatio: 2.81 } }, candidate).signal, "STANDBY");
});

test("Missing, malformed, stale or unapproved source data fails closed", async () => {
  const candles = history();
  assert.equal((await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false })).signal, "STANDBY");
  const malformed = history();
  malformed.at(-1).high = malformed.at(-1).low - 0.1;
  assert.equal((await analyzeMarket(malformed, { tickAgeSeconds: 0 })).signal, "STANDBY");
  const stale = history();
  stale.forEach(c => { c.epoch -= 600; });
  assert.equal((await analyzeMarket(stale, { now: Date.now(), tickAgeSeconds: 0 })).signal, "STANDBY");
});

test("Fresh REST fallback is accepted only when explicitly enabled", async () => {
  const candles = history();
  const allowed = await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: true });
  assert.equal(allowed.dataMode, "REST_FALLBACK");
  assert.equal(allowed.livePriceReady, true);
  const blocked = await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false });
  assert.equal(blocked.signal, "STANDBY");
});

test("Current live candle is excluded from Original AI closed-candle window", async () => {
  const candles = history();
  const liveEpoch = Math.floor(Date.now() / 60000) * 60;
  candles.push({ ...candles.at(-1), epoch: liveEpoch, live: true });
  const result = await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(result.closedCandleCount, 220);
  assert.equal(result.lastCandleEpoch, candles.at(-2).epoch);
});
