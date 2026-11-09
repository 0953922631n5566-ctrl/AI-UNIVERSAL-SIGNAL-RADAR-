import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { decide, MIN_SCORE, MIN_TREND_ADX } = require("../original-ai/engine/decision-engine.js");
const { evaluateTrendContinuation, MIN_CONTINUATION_SCORE } = require("../original-ai/strategies/trend-continuation.js");
const { classifyTrendRegime, MIN_TREND_ADX: SCANNER_ADX, buildHigherTimeframeContext } = require("../original-ai/scanner/trend-scanner.js");
const bullish = { adx: 25, plusDI: 28, minusDI: 10, macdHistogram: 0.0004, rsi: 60, volatilityRatio: 1, nearResistance: false, nearSupport: false };
const bearish = { adx: 25, plusDI: 10, minusDI: 28, macdHistogram: -0.0004, rsi: 40, volatilityRatio: 1, nearResistance: false, nearSupport: false };

test("strict decision threshold is 45 and trend entry requires ADX 18", () => {
  assert.equal(MIN_SCORE, 45); assert.equal(MIN_TREND_ADX, 18);
  const ctx = { regime: "UPTREND", higherTimeframe: { direction: "CALL" }, indicators: { ...bullish, adx: 18 } };
  assert.equal(decide(ctx, { signal: "CALL", score: 45, strategy: "UPTREND" }).signal, "CALL");
  assert.equal(decide(ctx, { signal: "CALL", score: 44, strategy: "UPTREND" }).signal, "STANDBY");
  assert.equal(decide({ ...ctx, indicators: { ...ctx.indicators, adx: 13.99 } }, { signal: "CALL", score: 80, strategy: "UPTREND" }).signal, "STANDBY");
});
test("M1 CALL and PUT both pass with transitional or unavailable M5 context", () => {
  assert.equal(decide({ regime: "UPTREND", higherTimeframe: { direction: "UNCLEAR" }, indicators: bullish }, { signal: "CALL", score: 65, strategy: "UPTREND" }).signal, "CALL");
  assert.equal(decide({ regime: "DOWNTREND", higherTimeframe: { direction: "UNCLEAR" }, indicators: bearish }, { signal: "PUT", score: 65, strategy: "DOWNTREND" }).signal, "PUT");
  assert.equal(decide({ regime: "DOWNTREND", indicators: bearish }, { signal: "PUT", score: 65, strategy: "DOWNTREND" }).signal, "PUT");
});
test("opposite M5 requires exceptional M1 strength and score", () => {
  const ctx = { regime: "DOWNTREND", higherTimeframe: { direction: "CALL" }, indicators: bearish };
  assert.equal(decide(ctx, { signal: "PUT", score: 64, strategy: "DOWNTREND" }).signal, "STANDBY");
  assert.equal(decide({ ...ctx, indicators: { ...bearish, adx: 24 } }, { signal: "PUT", score: 80, strategy: "DOWNTREND" }).signal, "STANDBY");
  assert.equal(decide(ctx, { signal: "PUT", score: 65, strategy: "DOWNTREND" }).signal, "PUT");
});
test("sideways market is blocked even when a strategy reports a high score", () => {
  const result = decide({ regime: "SIDEWAY", higherTimeframe: { direction: "CALL" }, indicators: { volatilityRatio: 1 } }, { signal: "CALL", score: 100, strategy: "SIDEWAY" });
  assert.equal(result.signal, "STANDBY"); assert.match(result.reason, /Sideways/);
});
test("trend continuation has symmetric CALL/PUT scoring at ADX 18 and score floor 45", () => {
  assert.equal(MIN_CONTINUATION_SCORE, 45);
  const pCall = { open: 1, high: 1.03, low: 0.99, close: 1.02 }, cCall = { open: 1, high: 1.12, low: 0.99, close: 1.10 };
  const call = evaluateTrendContinuation({ candles: [pCall, cCall], latest: cCall, indicators: { adx: 18, plusDI: 25, minusDI: 12, rsi: 60, macdHistogram: .001, ema9: 1.05 } }, "CALL");
  assert.equal(call.signal, "CALL"); assert.ok(call.score >= 45);
  const pPut = { open: 1.10, high: 1.11, low: 1.07, close: 1.08 }, cPut = { open: 1.08, high: 1.09, low: .98, close: .99 };
  const put = evaluateTrendContinuation({ candles: [pPut, cPut], latest: cPut, indicators: { adx: 18, plusDI: 12, minusDI: 25, rsi: 40, macdHistogram: -.001, ema9: 1.02 } }, "PUT");
  assert.equal(put.signal, "PUT"); assert.ok(put.score >= 45);
  const weak = evaluateTrendContinuation({ candles: [pCall, cCall], latest: cCall, indicators: { adx: 17.99, plusDI: 25, minusDI: 12, rsi: 60, macdHistogram: .001, ema9: 1.05 } }, "CALL");
  assert.equal(weak.signal, "STANDBY");
});
test("M5 context is derived from M1 history without another market-data request", () => {
  const candles = Array.from({ length: 200 }, (_, i) => { const close = 1.08 + i * .00002; return { time: i * 60000, open: close - .00001, high: close + .00002, low: close - .00002, close }; });
  const m5 = buildHigherTimeframeContext(candles); assert.equal(m5.candleCount, 40); assert.equal(m5.direction, "CALL");
});
test("trend regime classification uses M1 ADX, EMA alignment and DI independent of M5", () => {
  assert.equal(SCANNER_ADX, 18);
  const bull = { bullishAlignment: 2, bearishAlignment: 1, adx: 18, plusDI: 24, minusDI: 15 };
  const bear = { bullishAlignment: 1, bearishAlignment: 2, adx: 18, plusDI: 15, minusDI: 24 };
  assert.equal(classifyTrendRegime({ ...bull, higherTimeframe: { direction: "UNCLEAR" } }).regime, "UPTREND");
  assert.equal(classifyTrendRegime({ ...bear, higherTimeframe: { direction: "CALL" } }).regime, "DOWNTREND");
  assert.equal(classifyTrendRegime({ ...bull, adx: 17.99 }), null);
});

test("SIDEWAY permits only a multi-engine Range-Bound Swing candidate with safety approval", () => {
  const ctx = { regime: "SIDEWAY", higherTimeframe: { direction: "UNCLEAR" },
    indicators: { volatilityRatio: 1, nearSupport: true, nearResistance: false, rsi: 40 } };
  const candidate = { signal: "CALL", score: 68, confidence: 80, strategy: "RANGE_BOUND_SWING",
    engineResults: [
      { engine: "range_bound_swing", direction: "CALL", validity: true },
      { engine: "safety_noise_guard", direction: "NO_SIGNAL", validity: true, reason: "PASS: safe" }
    ] };
  assert.equal(decide(ctx, candidate).signal, "CALL");
  assert.equal(decide({ ...ctx, indicators: { ...ctx.indicators, volatilityRatio: 2.01 } }, candidate).signal, "STANDBY");
  assert.equal(decide(ctx, { ...candidate, engineResults: candidate.engineResults.slice(0, 1) }).signal, "STANDBY");
});
