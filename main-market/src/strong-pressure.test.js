import test from "node:test";
import assert from "node:assert/strict";
import { assessDirectionalPressure } from "./strong-pressure.js";

test("detects strong buying pressure early on a decisive bullish close", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0999, close: 1.10005 },
    { open: 1.10005, high: 1.1008, low: 1.1000, close: 1.10075 }
  ];
  const result = assessDirectionalPressure(candles, "CALL", {
    ema5: 1.1004, ema5Slope: 0.00005, atr: 0.0008
  });
  assert.equal(result.strong, true);
  assert.equal(result.type, "STRONG_BUYING_PRESSURE");
});

test("detects strong selling pressure early on a decisive bearish close", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0999, close: 1.09995 },
    { open: 1.09995, high: 1.1000, low: 1.0992, close: 1.09925 }
  ];
  const result = assessDirectionalPressure(candles, "PUT", {
    ema5: 1.0996, ema5Slope: -0.00005, atr: 0.0008
  });
  assert.equal(result.strong, true);
  assert.equal(result.type, "STRONG_SELLING_PRESSURE");
});

test("does not classify a long-wick indecision candle as strong pressure", () => {
  const candles = [
    { open: 1.1, high: 1.1009, low: 1.0999, close: 1.1001 }
  ];
  const result = assessDirectionalPressure(candles, "CALL", {
    ema5: 1.1, ema5Slope: 0.00001, atr: 0.0008
  });
  assert.equal(result.strong, false);
});

test("does not classify strong counter-direction candle as buying pressure", () => {
  const candles = [
    { open: 1.1007, high: 1.1008, low: 1.1, close: 1.10005 }
  ];
  const result = assessDirectionalPressure(candles, "CALL", {
    ema5: 1.1002, ema5Slope: 0.00005, atr: 0.0008
  });
  assert.equal(result.strong, false);
});

test("fails closed when ATR or EMA context is unavailable", () => {
  const candles = [{ open: 1.1, high: 1.101, low: 1.099, close: 1.1009 }];
  assert.equal(assessDirectionalPressure(candles, "CALL", { ema5: 1.1, ema5Slope: 0.1, atr: 0 }).ready, false);
});

import { qualifiesForStrongPressureEarlyEntry } from "./strong-pressure.js";

test("strong pressure can qualify V1 below the normal 65 threshold", () => {
  assert.equal(qualifiesForStrongPressureEarlyEntry({
    pressure: { strong: true }, score: 60, gap: 12
  }), true);
});

test("strong pressure fast lane rejects weak score or ambiguous direction", () => {
  assert.equal(qualifiesForStrongPressureEarlyEntry({ pressure: { strong: true }, score: 57.9, gap: 12 }), false);
  assert.equal(qualifiesForStrongPressureEarlyEntry({ pressure: { strong: true }, score: 60, gap: 7.9 }), false);
});

test("strong pressure fast lane never bypasses chop, ATR spike, or late-entry guard", () => {
  for (const extra of [{ choppy: true }, { atrSpike: true }, { waitForPullback: true }]) {
    assert.equal(qualifiesForStrongPressureEarlyEntry({
      pressure: { strong: true }, score: 62, gap: 10, ...extra
    }), false);
  }
});
