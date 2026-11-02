import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarket } from "../src/analyzer.js";

test("fresh REST-only candles are accepted as a fallback data source", () => {
  const start = 1_800_000_000;
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 1.1 + i * 0.00003;
    return { epoch: start + i * 60, time: new Date((start + i * 60) * 1000).toISOString(), open: close - 0.00001, high: close + 0.00003, low: close - 0.00003, close, live: false };
  });
  const now = (candles.at(-1).epoch + 70) * 1000;
  const result = analyzeMarket(candles, { now, tickAgeSeconds: null, allowRestFallback: true });
  assert.equal(result.livePriceReady, true);
  assert.equal(result.dataMode, "REST_FALLBACK");
});

test("REST-only data is not accepted when fallback is not enabled", () => {
  const start = 1_800_000_000;
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 1.1 + i * 0.00003;
    return { epoch: start + i * 60, time: new Date((start + i * 60) * 1000).toISOString(), open: close - 0.00001, high: close + 0.00003, low: close - 0.00003, close, live: false };
  });
  const now = (candles.at(-1).epoch + 70) * 1000;
  const result = analyzeMarket(candles, { now, tickAgeSeconds: null });
  assert.equal(result.livePriceReady, false);
  assert.equal(result.dataMode, "UNAVAILABLE");
});
