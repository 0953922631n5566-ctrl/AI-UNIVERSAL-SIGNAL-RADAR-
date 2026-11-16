import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrendRider } from "../src/trend-rider.js";

function risingCandles(count = 54) {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * 0.00005;
    return { open: close - 0.00008, close, high: close + 0.00004, low: close - 0.00012, live: false };
  });
}

test("Trend Rider requires valid closed-candle history", () => {
  const result = analyzeTrendRider(risingCandles(20));
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
});

test("Trend Rider detects a sustained rising trend independently", () => {
  const result = analyzeTrendRider(risingCandles());
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.ok(result.score >= 65);
});

test("Trend Rider fails closed on malformed OHLC data", () => {
  const rows = risingCandles();
  rows.at(-1).low = rows.at(-1).high + 1;
  const result = analyzeTrendRider(rows);
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
});

test("Trend Rider ignores optional V1 and BB values", () => {
  const result = analyzeTrendRider(risingCandles(), { v1: { signal: "PUT" }, bb: { signal: "PUT" } });
  assert.equal(result.signal, "CALL");
  assert.ok(result.metrics.ema5 > result.metrics.ema20);
});
