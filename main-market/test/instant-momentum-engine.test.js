import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInstantMomentum } from "../src/instant-momentum-engine.js";

const now = 1_800_000_000_000;
const epoch = Math.floor(now / 60_000) * 60;
function candles() {
  const rows = [];
  let close = 1.1;
  for (let i = 54; i > 0; i--) {
    const open = close;
    close += (i % 2 ? 1 : -1) * 0.00001;
    rows.push({ epoch: epoch - i * 60, open, high: Math.max(open, close) + 0.00008,
      low: Math.min(open, close) - 0.00008, close, live: false });
  }
  return rows;
}
function live(open, close, high = Math.max(open, close), low = Math.min(open, close)) {
  return { epoch, open, close, high, low, live: true };
}

test("opening bullish impulse triggers CALL in the first five seconds", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 2_000, tickAgeSeconds: 0.3 });
  assert.equal(result.signal, "CALL");
  assert.equal(result.strategy, "INSTANT_MOMENTUM_BREAKOUT");
});

test("opening bearish impulse triggers PUT in the first five seconds", () => {
  const rows = candles();
  rows.push(live(1.1, 1.09988, 1.10001, 1.09987));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 2_000, tickAgeSeconds: 0.2 });
  assert.equal(result.signal, "PUT");
});

test("four-candle high breakout triggers CALL without waiting for candle close", () => {
  const rows = candles();
  const priorHigh = Math.max(...rows.slice(-4).map(c => c.high));
  rows.push(live(priorHigh - 0.00001, priorHigh + 0.00004, priorHigh + 0.00005, priorHigh - 0.00002));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 1_000, tickAgeSeconds: 0.1 });
  assert.equal(result.signal, "CALL");
  assert.equal(result.metrics.bullishBreakout, true);
});

test("no directional output after the opening window", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 5_000, tickAgeSeconds: 0.1 });
  assert.equal(result.signal, "STANDBY");
});

test("stale streaming tick fails closed", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 2_000, tickAgeSeconds: 5.1 });
  assert.equal(result.signal, "STANDBY");
});

test("closed candles alone never create an opening signal", () => {
  const result = analyzeInstantMomentum({ candles: candles(), now, tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
});

test("uses provider event time when a fresh opening tick is delivered a few seconds late", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({
    candles: rows, now: now + 7_000, tickEventAt: now + 3_000, tickAgeSeconds: 0.5
  });
  assert.equal(result.signal, "CALL");
  assert.equal(result.metrics.elapsedMs, 3_000);
});

test("rejects a provider tick whose event timestamp is outside the opening window", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({
    candles: rows, now: now + 7_000, tickEventAt: now + 5_000, tickAgeSeconds: 0.5
  });
  assert.equal(result.signal, "STANDBY");
});

test("rejects an old provider event timestamp even when the server just received it", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({
    candles: rows, now: now + 38_000, tickEventAt: now, tickAgeSeconds: 0.2
  });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /Timestamp/);
});
