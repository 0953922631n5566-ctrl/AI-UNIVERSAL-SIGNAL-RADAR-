import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarket } from "../src/analyzer.js";

function recentClosedCandles() {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - 80 * 60;
  return Array.from({ length: 80 }, (_, i) => {
    const close = 1.1 + i * 0.00003;
    return { epoch: start + i * 60, time: new Date((start + i * 60) * 1000).toISOString(), open: close - 0.00001, high: close + 0.00003, low: close - 0.00003, close, live: false };
  });
}

test("fresh REST-only candles are accepted as a fallback data source", () => {
  const result = analyzeMarket(recentClosedCandles(), { now: Date.now(), tickAgeSeconds: null, allowRestFallback: true });
  assert.equal(result.livePriceReady, true);
  assert.equal(result.dataMode, "REST_FALLBACK");
});

test("REST-only data is not accepted when fallback is not enabled", () => {
  const result = analyzeMarket(recentClosedCandles(), { now: Date.now(), tickAgeSeconds: null });
  assert.equal(result.livePriceReady, false);
  assert.equal(result.dataMode, "UNAVAILABLE");
});
