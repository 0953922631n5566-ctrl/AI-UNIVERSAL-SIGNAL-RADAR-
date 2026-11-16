import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBBPureScalper } from "../src/bb-pure-scalper.js";

function baseCandles(count = 24) {
  const rows = [];
  let price = 1.1;
  for (let i = 0; i < count; i++) {
    const open = price;
    price += (i % 2 === 0 ? 1 : -1) * 0.00002;
    rows.push({ open, close: price, high: Math.max(open, price) + 0.00004,
      low: Math.min(open, price) - 0.00004, live: false });
  }
  return rows;
}

test("BB Pure Scalper stays neutral when price does not touch an outer band", () => {
  const result = analyzeBBPureScalper(baseCandles());
  assert.equal(result.ready, true);
  assert.equal(result.signal, null);
  assert.equal(result.status, "NO_BAND_TOUCH");
});

test("BB Pure Scalper does not call a touch alone a reversal", () => {
  const rows = baseCandles();
  const bands = analyzeBBPureScalper(rows).bands;
  const last = rows.at(-1);
  last.open = bands.upper - 0.000005;
  last.high = bands.upper + 0.00012;
  last.close = bands.upper + 0.00008;
  last.low = last.open - 0.000005;
  const result = analyzeBBPureScalper(rows);
  assert.equal(result.signal, null);
  assert.equal(result.status, "TOUCH_WITHOUT_CONFIRMATION");
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
