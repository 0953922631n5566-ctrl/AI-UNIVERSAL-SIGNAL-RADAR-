import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decide, MIN_SCORE } = require("../original-ai/engine/decision-engine.js");
const { evaluateTrendContinuation } = require("../original-ai/strategies/trend-continuation.js");

test("Original AI candidate threshold is 40 and score 39 remains standby", () => {
  assert.equal(MIN_SCORE, 40);
  const context = {
    regime: "UPTREND",
    indicators: {
      adx: 18, plusDI: 25, minusDI: 12, macdHistogram: 0.0002,
      rsi: 55, volatilityRatio: 1, nearResistance: false, nearSupport: false
    }
  };
  assert.equal(decide(context, { signal: "CALL", score: 40, strategy: "UPTREND" }).signal, "CALL");
  assert.equal(decide(context, { signal: "CALL", score: 39, strategy: "UPTREND" }).signal, "STANDBY");
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
