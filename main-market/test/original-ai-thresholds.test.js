import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decide, MIN_SCORE, MIN_TREND_ADX } = require("../original-ai/engine/decision-engine.js");
const { evaluateTrendContinuation, MIN_CONTINUATION_SCORE } = require("../original-ai/strategies/trend-continuation.js");
const { classifyTrendRegime, MIN_TREND_ADX: SCANNER_ADX, buildHigherTimeframeContext } =
  require("../original-ai/scanner/trend-scanner.js");

test("strict decision threshold is 45 and trend entry requires ADX 18", () => {
  assert.equal(MIN_SCORE, 45);
  assert.equal(MIN_TREND_ADX, 18);
  const context = {
    regime: "UPTREND",
    higherTimeframe: { direction: "CALL" },
    indicators: {
      adx: 18, plusDI: 25, minusDI: 12, macdHistogram: 0.0002,
      rsi: 55, volatilityRatio: 1, nearResistance: false, nearSupport: false
    }
  };
  assert.equal(decide(context, { signal: "CALL", score: 45, strategy: "UPTREND" }).signal, "CALL");
  assert.equal(decide(context, { signal: "CALL", score: 44, strategy: "UPTREND" }).signal, "STANDBY");
  assert.equal(decide({ ...context, indicators: { ...context.indicators, adx: 17.99 } },
    { signal: "CALL", score: 80, strategy: "UPTREND" }).signal, "STANDBY");
});

test("M5 disagreement and missing M5 confirmation fail closed", () => {
  const context = {
    regime: "UPTREND",
    higherTimeframe: { direction: "PUT" },
    indicators: { adx: 30, plusDI: 28, minusDI: 10, macdHistogram: 0.0004,
      rsi: 60, volatilityRatio: 1, nearResistance: false, nearSupport: false }
  };
  const candidate = { signal: "CALL", score: 100, strategy: "UPTREND" };
  assert.equal(decide(context, candidate).signal, "STANDBY");
  assert.equal(decide({ ...context, higherTimeframe: undefined }, candidate).signal, "STANDBY");
});

test("sideways market is blocked even when a strategy reports a high score", () => {
  const result = decide({
    regime: "SIDEWAY",
    higherTimeframe: { direction: "CALL" },
    indicators: { volatilityRatio: 1, nearSupport: true, nearResistance: false }
  }, { signal: "CALL", score: 100, strategy: "SIDEWAY" });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /Sideways/);
});

test("trend continuation uses a 45-point weighted evidence floor with ADX 18 hard gate", () => {
  assert.equal(MIN_CONTINUATION_SCORE, 45);
  const previous = { open: 1.0, high: 1.03, low: 0.99, close: 1.02 };
  const latest = { open: 1.0, high: 1.12, low: 0.99, close: 1.10 };
  const result = evaluateTrendContinuation({
    candles: [previous, latest], latest,
    indicators: { adx: 18, plusDI: 25, minusDI: 12, rsi: 60,
      macdHistogram: 0.001, ema9: 1.05 }
  }, "CALL");
  assert.equal(result.signal, "CALL");
  assert.ok(result.score >= 45);
  const weakTrend = evaluateTrendContinuation({
    candles: [previous, latest], latest,
    indicators: { adx: 17.99, plusDI: 25, minusDI: 12, rsi: 60,
      macdHistogram: 0.001, ema9: 1.05 }
  }, "CALL");
  assert.equal(weakTrend.signal, "STANDBY");
});

test("M5 context is derived from M1 history without another market-data request", () => {
  const candles = Array.from({ length: 200 }, (_, i) => {
    const close = 1.08 + i * 0.00002;
    return { time: i * 60000, open: close - 0.00001, high: close + 0.00002,
      low: close - 0.00002, close };
  });
  const m5 = buildHigherTimeframeContext(candles);
  assert.equal(m5.candleCount, 40);
  assert.equal(m5.direction, "CALL");
});

test("trend regime classification requires ADX 18 and aligned M5 direction", () => {
  assert.equal(SCANNER_ADX, 18);
  const base = { bullishAlignment: 2, bearishAlignment: 1, adx: 18, plusDI: 24, minusDI: 15 };
  assert.equal(classifyTrendRegime({ ...base, higherTimeframe: { direction: "CALL" } }).regime, "UPTREND");
  assert.equal(classifyTrendRegime({ ...base, higherTimeframe: { direction: "PUT" } }), null);
  assert.equal(classifyTrendRegime({ ...base, adx: 17.99, higherTimeframe: { direction: "CALL" } }), null);
});
