import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decide, MIN_SCORE } = require("../original-ai/engine/decision-engine.js");
const { evaluateTrendContinuation } = require("../original-ai/strategies/trend-continuation.js");

test("Original AI candidate threshold is 35 and score 34 remains standby", () => {
  assert.equal(MIN_SCORE, 35);
  const context = {
    regime: "UPTREND",
    indicators: {
      adx: 18, plusDI: 25, minusDI: 12, macdHistogram: 0.0002,
      rsi: 55, volatilityRatio: 1, nearResistance: false, nearSupport: false
    }
  };
  assert.equal(decide(context, { signal: "CALL", score: 35, strategy: "UPTREND" }).signal, "CALL");
  assert.equal(decide(context, { signal: "CALL", score: 34, strategy: "UPTREND" }).signal, "STANDBY");
});

test("Trend continuation can pass at 40 when two independent evidence checks align", () => {
  const previous = { open: 1.0, high: 1.12, low: 0.98, close: 1.05 };
  const latest = { open: 1.0, high: 1.4, low: 0.99, close: 1.1 };
  const result = evaluateTrendContinuation({
    candles: [previous, latest],
    latest,
    indicators: {
      adx: 18, plusDI: 10, minusDI: 20, rsi: 30,
      macdHistogram: -0.001, ema9: 1.05
    }
  }, "CALL");
  // ADX and pullback/reclaim are the two qualifying checks; weak candle flow
  // and unaligned momentum keep the score at the new minimum.
  assert.equal(result.score, 40);
  assert.equal(result.signal, "CALL");
});


const { classifyTrendRegime, MIN_TREND_ADX } = require("../original-ai/scanner/trend-scanner.js");

test("second-step regime threshold is ADX 14", () => {
  assert.equal(MIN_TREND_ADX, 14);
});

test("two of three bullish EMA relationships plus directional DI are enough at ADX 14", () => {
  const result = classifyTrendRegime({
    bullishAlignment: 2, bearishAlignment: 1, adx: 16,
    plusDI: 24, minusDI: 15
  });
  assert.equal(result.regime, "UPTREND");
});

test("two of three bearish EMA relationships plus directional DI are enough at ADX 16", () => {
  const result = classifyTrendRegime({
    bullishAlignment: 1, bearishAlignment: 2, adx: 16,
    plusDI: 13, minusDI: 22
  });
  assert.equal(result.regime, "DOWNTREND");
});

test("weak ADX, one EMA relationship, or conflicting DI does not classify a trend", () => {
  assert.equal(classifyTrendRegime({
    bullishAlignment: 3, bearishAlignment: 0, adx: 13.99,
    plusDI: 24, minusDI: 12
  }), null);
  assert.equal(classifyTrendRegime({
    bullishAlignment: 1, bearishAlignment: 2, adx: 20,
    plusDI: 24, minusDI: 12
  }), null);
  assert.equal(classifyTrendRegime({
    bullishAlignment: 2, bearishAlignment: 1, adx: 20,
    plusDI: 12, minusDI: 24
  }), null);
});
