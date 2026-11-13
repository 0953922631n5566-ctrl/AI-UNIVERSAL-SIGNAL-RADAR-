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

test("aggressive bullish impulse triggers CALL throughout the current M1 candle", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 27_000, tickEventAt: now + 27_000, tickAgeSeconds: 0.3 });
  assert.equal(result.signal, "CALL");
  assert.equal(result.strategy, "AGGRESSIVE_MOMENTUM_BREAKOUT");
  assert.equal(result.riskLevel, "HIGH");
  assert.equal(result.entryType, "LIVE_M1_INTRAMINUTE");
});

test("aggressive bearish impulse triggers PUT mid-candle", () => {
  const rows = candles();
  rows.push(live(1.1, 1.09988, 1.10001, 1.09987));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 42_000, tickEventAt: now + 42_000, tickAgeSeconds: 0.2 });
  assert.equal(result.signal, "PUT");
});

test("four-candle breakout triggers CALL without waiting for candle close", () => {
  const rows = candles();
  const priorHigh = Math.max(...rows.slice(-4).map(c => c.high));
  rows.push(live(priorHigh - 0.00001, priorHigh + 0.00004, priorHigh + 0.00005, priorHigh - 0.00002));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 15_000, tickEventAt: now + 15_000, tickAgeSeconds: 0.1 });
  assert.equal(result.signal, "CALL");
  assert.equal(result.setupType, "BREAKOUT");
});

test("rejects a tick outside the current M1 candle", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 60_000, tickEventAt: now + 60_000, tickAgeSeconds: 0.1 });
  assert.equal(result.signal, "STANDBY");
});

test("stale streaming tick fails closed", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 20_000, tickEventAt: now + 14_000, tickAgeSeconds: 5.1 });
  assert.equal(result.signal, "STANDBY");
});

test("closed candles alone never create a directional signal", () => {
  const result = analyzeInstantMomentum({ candles: candles(), now, tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
});

test("accepts a provider event timestamp from earlier in the same M1 candle when receipt is fresh", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 58_000, tickEventAt: now + 2_000, tickAgeSeconds: 0.2 });
  assert.equal(result.signal, "CALL");
});

test("rejects a provider event timestamp from the previous M1 candle", () => {
  const rows = candles();
  rows.push(live(1.1, 1.10012, 1.10013, 1.09999));
  const result = analyzeInstantMomentum({ candles: rows, now: now + 8_000, tickEventAt: now - 1_000, tickAgeSeconds: 0.2 });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /แท่ง M1/);
});
