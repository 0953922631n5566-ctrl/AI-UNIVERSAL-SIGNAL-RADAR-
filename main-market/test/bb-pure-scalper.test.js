import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBBPureScalper } from "../src/bb-pure-scalper.js";

function baseCandles(count = 21) {
  const start = Math.floor(Date.now() / 60000) * 60 - (count + 2) * 60;
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + Math.sin(i * 1.3) * 0.00005;
    const open = i ? 1.1 + Math.sin((i - 1) * 1.3) * 0.00005 : close - 0.00001;
    return {
      epoch: start + i * 60, open,
      high: Math.max(open, close) + 0.00001,
      low: Math.min(open, close) - 0.00001,
      close, live: false
    };
  });
}

function bullishTouch() {
  return { epoch: 0, open: 1.09998, high: 1.10003, low: 1.0994, close: 1.10002, live: false };
}
function bullishConfirmation() {
  return { epoch: 60, open: 1.10002, high: 1.10009, low: 1.10001, close: 1.10008, live: false };
}
function bearishTouch() {
  return { epoch: 0, open: 1.10002, high: 1.1006, low: 1.09997, close: 1.09998, live: false };
}
function bearishConfirmation() {
  return { epoch: 60, open: 1.09998, high: 1.09999, low: 1.09991, close: 1.09992, live: false };
}

test("BB touch/rejection alone waits; it cannot emit an immediate CALL", () => {
  const candles = [...baseCandles(), bullishTouch()];
  const result = analyzeBBPureScalper(candles);
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.setup, "WAIT_FOR_CONFIRMATION");
  assert.equal(result.confirmed, false);
});

test("BB lower-band rejection plus next closed candle breaking rejection high confirms CALL", () => {
  const candles = [...baseCandles(), bullishTouch(), bullishConfirmation()];
  const result = analyzeBBPureScalper(candles);
  assert.equal(result.signal, "CALL");
  assert.equal(result.setup, "CONFIRMED_REVERSAL");
  assert.equal(result.confirmed, true);
});

test("BB upper-band rejection plus next closed candle breaking rejection low confirms PUT", () => {
  const candles = [...baseCandles(), bearishTouch(), bearishConfirmation()];
  const result = analyzeBBPureScalper(candles);
  assert.equal(result.signal, "PUT");
  assert.equal(result.setup, "CONFIRMED_REVERSAL");
  assert.equal(result.confirmed, true);
});

test("BB standalone fails closed with insufficient or malformed closed candles", () => {
  assert.equal(analyzeBBPureScalper([]).signal, "STANDBY");
  const candles = [...baseCandles(), bullishTouch()];
  candles[0].high = candles[0].low - 1;
  assert.equal(analyzeBBPureScalper(candles).ready, false);
});

test("BB standalone ignores an in-progress live candle", () => {
  const candles = [...baseCandles(), bullishTouch(), { ...bullishConfirmation(), live: true }];
  const result = analyzeBBPureScalper(candles);
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.setup, "WAIT_FOR_CONFIRMATION");
});
