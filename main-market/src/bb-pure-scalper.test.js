import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBBPureScalper } from "./bb-pure-scalper.js";

function history(n = 25, base = 1.1) {
  return Array.from({ length: n }, (_, i) => ({
    epoch: i * 60, open: base, high: base + 0.0002,
    low: base - 0.0002, close: base, live: false
  }));
}

test("rejects insufficient and malformed history", () => {
  assert.equal(analyzeBBPureScalper([]).ready, false);
  const xs = history(); xs[0].high = 0;
  assert.equal(analyzeBBPureScalper(xs).ready, false);
});

test("valid history returns BB standalone pressure diagnostics", () => {
  const result = analyzeBBPureScalper(history());
  assert.equal(result.strategy, "BB_PURE_SCALPER_STANDALONE_B");
  assert.equal(result.ready, true);
  assert.ok(Number.isFinite(result.metrics.buyingPressure));
  assert.ok(Number.isFinite(result.metrics.sellingPressure));
});

test("ignores live in-progress candle and retains the last closed candle timestamp", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.2, low: 1, close: 1.15, live: true });
  const result = analyzeBBPureScalper(xs);
  assert.equal(result.metrics.lastClosedCandleEpoch, 1440);
  assert.equal(result.signal, "STANDBY");
});

test("touch without a valid rejection does not trigger reversal", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.1002, low: 1.0990, close: 1.0991 });
  assert.equal(analyzeBBPureScalper(xs).signal, "STANDBY");
});

test("BB lower-band rejection alone waits for next-candle confirmation", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.1001, low: 1.0985, close: 1.10005 });
  const result = analyzeBBPureScalper(xs);
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.setup, "WAIT_FOR_CONFIRMATION");
  assert.equal(result.confirmed, false);
});

test("BB upper-band rejection alone waits for next-candle confirmation", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.1015, low: 1.0999, close: 1.09995 });
  const result = analyzeBBPureScalper(xs);
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.setup, "WAIT_FOR_CONFIRMATION");
  assert.equal(result.confirmed, false);
});

test("next closed candle confirms CALL only after breaking the rejection candle high", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.1001, low: 1.0985, close: 1.10005 });
  xs.push({ epoch: 1560, open: 1.1000, high: 1.1004, low: 1.0999, close: 1.1003 });
  const result = analyzeBBPureScalper(xs);
  assert.equal(result.signal, "CALL");
  assert.equal(result.setup, "CONFIRMED_REVERSAL");
  assert.equal(result.confirmed, true);
});

test("next closed candle confirms PUT only after breaking the rejection candle low", () => {
  const xs = history();
  xs.push({ epoch: 1500, open: 1.1, high: 1.1015, low: 1.0999, close: 1.09995 });
  xs.push({ epoch: 1560, open: 1.1000, high: 1.1001, low: 1.0996, close: 1.0997 });
  const result = analyzeBBPureScalper(xs);
  assert.equal(result.signal, "PUT");
  assert.equal(result.setup, "CONFIRMED_REVERSAL");
  assert.equal(result.confirmed, true);
});
