import test from "node:test";
import assert from "node:assert/strict";
import { applyLevel1FalseSignalFilter } from "../src/false-signal-filter.js";

function analysis(signal, metrics = {}) {
  return { signal, status: "SIGNAL", prepareSignal: null, riskFlags: [], metrics };
}

test("Level 1 blocks CALL on a strong upper-wick rejection", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001 },
    { open: 1.1001, high: 1.1010, low: 1.1000, close: 1.1002 }
  ];
  const result = applyLevel1FalseSignalFilter(candles, analysis("CALL"));
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.falseSignalFilter.blocked, true);
  assert.ok(result.falseSignalFilter.reasons.includes("OPPOSING_WICK_REJECTION"));
});

test("Level 1 blocks PUT on a strong lower-wick rejection", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0998, close: 1.0999 },
    { open: 1.0999, high: 1.1000, low: 1.0990, close: 1.0998 }
  ];
  const result = applyLevel1FalseSignalFilter(candles, analysis("PUT"));
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.falseSignalFilter.blocked, true);
});

test("Level 1 blocks stacked opposing candle, EMA5 slope and DMI", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001 },
    { open: 1.1002, high: 1.1003, low: 1.0997, close: 1.0998 }
  ];
  const result = applyLevel1FalseSignalFilter(candles, analysis("CALL", {
    ema5Slope: -0.0001, plusDI: 10, minusDI: 25
  }));
  assert.equal(result.signal, "STANDBY");
  assert.ok(result.falseSignalFilter.reasons.includes("CANDLE_EMA_DMI_DIRECTION_CONFLICT"));
});

test("Level 1 leaves non-directional states and clean directional candles unchanged", () => {
  const candles = [
    { open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001 },
    { open: 1.1001, high: 1.1005, low: 1.1000, close: 1.1004 }
  ];
  const clean = applyLevel1FalseSignalFilter(candles, analysis("CALL"));
  const standby = applyLevel1FalseSignalFilter(candles, analysis("STANDBY"));
  assert.equal(clean.signal, "CALL");
  assert.equal(clean.falseSignalFilter.blocked, false);
  assert.equal(standby.signal, "STANDBY");
  assert.equal(standby.falseSignalFilter.blocked, false);
});
