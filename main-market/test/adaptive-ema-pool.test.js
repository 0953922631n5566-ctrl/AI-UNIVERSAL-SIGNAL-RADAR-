import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAdaptiveEmaPool, ADAPTIVE_EMA_PERIODS } from "../src/adaptive-ema-pool.js";

function trendCandles(count = 60) {
  return Array.from({ length: count }, (_, index) => {
    const open = 1.08 + index * 0.0002;
    const close = open + 0.0002;
    return { epoch: 1_700_000_000 + index * 60, open, high: close + 0.00005, low: open - 0.00005, close };
  });
}

function sidewayCandles(count = 60) {
  let previous = 1.08;
  return Array.from({ length: count }, (_, index) => {
    const close = 1.08 + (index % 2 === 0 ? 0.0001 : -0.0001);
    const open = previous;
    previous = close;
    return { epoch: 1_700_000_000 + index * 60, open, high: Math.max(open, close) + 0.00005,
      low: Math.min(open, close) - 0.00005, close };
  });
}

test("adaptive EMA pool evaluates 100 distinct candidate horizons", () => {
  assert.equal(ADAPTIVE_EMA_PERIODS.length, 100);
  assert.equal(ADAPTIVE_EMA_PERIODS[0], 2);
  assert.equal(ADAPTIVE_EMA_PERIODS.at(-1), 101);
});

test("trending candles select a candidate and produce a shadow-only CALL", () => {
  const result = analyzeAdaptiveEmaPool(trendCandles());
  assert.equal(result.ready, true);
  assert.equal(result.mode, "SHADOW_ONLY");
  assert.equal(result.regime, "TRENDING");
  assert.equal(result.candidateCount, 100);
  assert.equal(result.signal, "CALL");
  assert.ok(result.selectedPeriod >= 2 && result.selectedPeriod <= 101);
  assert.equal(result.topCandidates.length, 5);
});

test("sideway candles are classified and never release a directional signal", () => {
  const result = analyzeAdaptiveEmaPool(sidewayCandles());
  assert.equal(result.regime, "SIDEWAY");
  assert.equal(result.signal, "STANDBY");
  assert.ok(result.riskFlags.includes("SHADOW_NOT_RELEASED"));
});

test("invalid or insufficient candles safely return STANDBY", () => {
  const result = analyzeAdaptiveEmaPool([{ open: 1, high: 1, low: 1, close: 1 }]);
  assert.equal(result.ready, false);
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.selectedPeriod, null);
});

test("analysis does not mutate candle input", () => {
  const candles = trendCandles();
  const before = structuredClone(candles);
  analyzeAdaptiveEmaPool(candles);
  assert.deepEqual(candles, before);
});
