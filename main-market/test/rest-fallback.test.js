import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarket } from "../src/analyzer.js";

function recentClosedCandles() {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - 220 * 60;
  return Array.from({ length: 220 }, (_, i) => {
    const close = 1.1 + Math.sin(i / 4) * 0.0002 + i * 0.000001;
    const open = close - 0.00001;
    return { epoch: start + i * 60, time: new Date((start + i * 60) * 1000).toISOString(),
      open, high: Math.max(open, close) + 0.00003, low: Math.min(open, close) - 0.00003,
      close, live: false };
  });
}

test("REST history remains context only and cannot release a live opening signal", async () => {
  const result = await analyzeMarket(recentClosedCandles(), {
    now: Date.now(), tickAgeSeconds: null, allowRestFallback: true
  });
  assert.equal(result.dataMode, "UNAVAILABLE");
  assert.equal(result.livePriceReady, false);
  assert.equal(result.signal, "STANDBY");
  assert.equal("assistant" in result, false);
});

test("REST-only candles remain STANDBY even if a caller requests fallback", async () => {
  const result = await analyzeMarket(recentClosedCandles(), {
    now: Date.now(), tickAgeSeconds: null, allowRestFallback: false
  });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.dataMode, "UNAVAILABLE");
});
