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

test("Original AI data warm-up remains 200 closed M1 candles", () => {
  assert.equal(MIN_CLOSED_CANDLES, 200);
  assert.equal(HISTORY_CANDLES, 200);
  assert.equal(MAX_CANDLES, 220);
});

test("Original AI is the sole decision path and returns the direct engine result", () => {
  const candles = history();
  const direct = analyzeOriginal(candles.slice(-MIN_CLOSED_CANDLES));
  const routed = analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(routed.signal, direct.signal);
  assert.equal(routed.regime, direct.regime);
  assert.equal(routed.strategy, direct.strategy);
  assert.equal(routed.score, direct.score);
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
  assert.equal(MIN_TREND_ADX, 18);
  const base = {
    regime: "UPTREND",
    higherTimeframe: { direction: "CALL" },
    indicators: { adx: 18, plusDI: 30, minusDI: 12, macdHistogram: 0.0001,
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
  assert.equal(decide({ ...base, indicators: { ...base.indicators, adx: 17.99 } }, candidate).signal, "STANDBY");
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

test("Missing, malformed, stale or unapproved source data fails closed", () => {
  const candles = history();
  assert.equal(analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false }).signal, "STANDBY");
  const malformed = history();
  malformed.at(-1).high = malformed.at(-1).low - 0.1;
  assert.equal(analyzeMarket(malformed, { tickAgeSeconds: 0 }).signal, "STANDBY");
  const stale = history();
  stale.forEach(c => { c.epoch -= 600; });
  assert.equal(analyzeMarket(stale, { now: Date.now(), tickAgeSeconds: 0 }).signal, "STANDBY");
});

test("Fresh REST fallback is accepted only when explicitly enabled", () => {
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
