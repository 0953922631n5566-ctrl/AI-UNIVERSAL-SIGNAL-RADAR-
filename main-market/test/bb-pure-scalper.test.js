import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBBPureScalper } from "../src/bb-pure-scalper.js";

function baseCandles(count = 24) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const close = 1.1 + i * 0.00001;
    const open = close - 0.000008;
    rows.push({ open, close, high: Math.max(open, close) + 0.000005,
      low: Math.min(open, close) - 0.000005, live: false });
  }
  return rows;
}

test("BB Pure Scalper stays neutral when price does not touch an outer band", () => {
  const result = analyzeBBPureScalper(baseCandles());
  assert.equal(result.ready, true);
  assert.equal(result.signal, null);
  assert.equal(result.status, "NO_BAND_TOUCH");
});

test("BB Pure Scalper does not reverse on a band touch with no reclaim, wick, or bearish turn", () => {
  const rows = baseCandles();
  const bands = analyzeBBPureScalper(rows).bands;
  const last = rows.at(-1);
  last.close = bands.upper + 0.0005;
  last.open = last.close - 0.0001;
  last.high = last.close + 0.000001;
  last.low = last.open - 0.000001;
  const result = analyzeBBPureScalper(rows);
  assert.equal(result.signal, null);
  assert.equal(result.status, "TOUCH_WATCHING");
});

test("BB upper-band rejection confirms PUT after close returns inside with upper wick", () => {
  const rows = baseCandles();
  const bands = analyzeBBPureScalper(rows).bands;
  const last = rows.at(-1);
  last.open = bands.upper - 0.00001;
  last.high = bands.upper + 0.00012;
  last.close = bands.upper - 0.00008;
  last.low = last.close - 0.00001;
  const result = analyzeBBPureScalper(rows);
  assert.equal(result.signal, "PUT");
  assert.equal(result.status, "REJECTION_CONFIRMED");
});

test("BB lower-band rejection confirms CALL after close returns inside with lower wick", () => {
  const rows = baseCandles();
  const bands = analyzeBBPureScalper(rows).bands;
  const last = rows.at(-1);
  last.open = bands.lower + 0.00001;
  last.low = bands.lower - 0.00012;
  last.close = bands.lower + 0.00008;
  last.high = last.close + 0.00001;
  const result = analyzeBBPureScalper(rows);
  assert.equal(result.signal, "CALL");
  assert.equal(result.status, "REJECTION_CONFIRMED");
});

test("BB Pure Scalper fails closed on insufficient candles", () => {
  const result = analyzeBBPureScalper(baseCandles(10));
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
});

test("BB Pure Scalper evaluates a provisional current M1 candle supplied after closed history", () => {
  const rows = baseCandles();
  const bands = analyzeBBPureScalper(rows).bands;
  const previous = rows.at(-1);
  const preview = {
    ...previous, open: bands.lower + 0.00001, low: bands.lower - 0.00012,
    close: bands.lower + 0.00008, high: bands.lower + 0.00009,
    live: false, provisional: true
  };
  const result = analyzeBBPureScalper([...rows, preview]);
  assert.equal(result.signal, "CALL");
  assert.equal(result.status, "REJECTION_CONFIRMED");
});
