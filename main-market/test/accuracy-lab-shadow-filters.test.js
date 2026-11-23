import test from "node:test";
import assert from "node:assert/strict";
import { evaluateShadowFilters } from "../src/accuracy-lab/shadow-filters.js";

function candlesFrom(closes, bodyDirection = 1) {
  return closes.map((close, i) => {
    const previous = i ? closes[i - 1] : close - bodyDirection * 0.0001;
    const open = previous;
    return {
      open,
      high: Math.max(open, close) + 0.00002,
      low: Math.min(open, close) - 0.00002,
      close
    };
  });
}

test("shadow filter is diagnostic only and never changes the baseline direction", () => {
  const data = candlesFrom(Array.from({ length: 30 }, (_, i) => 1.1 + i * 0.0001));
  const result = evaluateShadowFilters(data, "CALL");
  assert.equal(result.baselineSignal, "CALL");
  assert.equal(typeof result.candidateWouldReject, "boolean");
  assert.equal(result.ready, true);
});

test("invalid direction or insufficient candle history fails closed without a veto", () => {
  assert.equal(evaluateShadowFilters([], "CALL").ready, false);
  assert.equal(evaluateShadowFilters(candlesFrom([1, 2, 3]), "PUT").ready, false);
  assert.equal(evaluateShadowFilters(candlesFrom(Array(30).fill(1)), "STANDBY").ready, false);
});

test("a strong opposing wick is identified for CALL without mutating the signal", () => {
  const data = candlesFrom(Array.from({ length: 29 }, (_, i) => 1.1 + i * 0.00001));
  data.push({ open: 1.1003, high: 1.1010, low: 1.1002, close: 1.1004 });
  const result = evaluateShadowFilters(data, "CALL");
  assert.equal(result.ready, true);
  assert.ok(result.flags.includes("STRONG_OPPOSING_WICK"));
  assert.equal(result.baselineSignal, "CALL");
});

test("PUT diagnostics measure the lower wick as the opposing wick", () => {
  const data = candlesFrom(Array.from({ length: 29 }, (_, i) => 1.2 - i * 0.00001), -1);
  data.push({ open: 1.1997, high: 1.1998, low: 1.1990, close: 1.1996 });
  const result = evaluateShadowFilters(data, "PUT");
  assert.equal(result.ready, true);
  assert.ok(result.flags.includes("STRONG_OPPOSING_WICK"));
  assert.equal(result.baselineSignal, "PUT");
});
