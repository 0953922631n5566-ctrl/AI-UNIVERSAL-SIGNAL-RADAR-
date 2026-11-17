import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCandlePreview } from "../src/live-candle-preview.js";

function liveCandle(epoch) {
  return { epoch, time: "live", open: 1.1000, high: 1.1010,
    low: 1.0990, close: 1.1005, live: true };
}

test("creates a non-mutating provisional snapshot for a fresh current M1 candle", () => {
  const now = Date.now();
  const epoch = Math.floor(now / 60_000) * 60;
  const source = liveCandle(epoch);
  const preview = createLiveCandlePreview(source, { now, tickAt: now - 500, maxAgeMs: 5_000 });
  assert.ok(preview);
  assert.equal(preview.live, false);
  assert.equal(preview.provisional, true);
  assert.equal(source.live, true);
  assert.equal(source.provisional, undefined);
  assert.equal(preview.epoch, epoch);
});

test("rejects stale ticks and candles from another minute", () => {
  const now = Date.now();
  const epoch = Math.floor(now / 60_000) * 60;
  assert.equal(createLiveCandlePreview(liveCandle(epoch), {
    now, tickAt: now - 5_001, maxAgeMs: 5_000
  }), null);
  assert.equal(createLiveCandlePreview(liveCandle(epoch - 60), {
    now, tickAt: now, maxAgeMs: 5_000
  }), null);
});

test("rejects malformed OHLC and already-closed candles", () => {
  const now = Date.now();
  const epoch = Math.floor(now / 60_000) * 60;
  const malformed = { ...liveCandle(epoch), high: 1.0 };
  assert.equal(createLiveCandlePreview(malformed, { now, tickAt: now }), null);
  assert.equal(createLiveCandlePreview({ ...liveCandle(epoch), live: false }, {
    now, tickAt: now
  }), null);
});
