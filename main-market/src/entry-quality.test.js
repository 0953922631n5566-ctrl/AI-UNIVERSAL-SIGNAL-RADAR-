import test from "node:test";
import assert from "node:assert/strict";
import { assessEntryQuality } from "./entry-quality.js";

function candlesWithTrend(direction = 1, count = 20) {
  let close = 1.1;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    close += direction * 0.0001;
    return { open, close, high: Math.max(open, close) + 0.00002, low: Math.min(open, close) - 0.00002 };
  });
}

function action(overrides = {}) {
  return {
    ready: true,
    structure: { priorTrend: "UP" },
    exhaustion: { sameDirectionRun: 1, bodyContraction: 0, opposingWickRatio: 0 },
    ...overrides
  };
}

test("V1 blocks CALL immediately below a recent swing high without a confirmed close breakout", () => {
  const candles = candlesWithTrend(1);
  const prior = candles.slice(-7, -1);
  const high = Math.max(...prior.map(c => c.high));
  const last = candles.at(-1);
  last.open = high - 0.00008;
  last.close = high - 0.00002;
  last.high = high + 0.00001;
  last.low = last.open - 0.00001;
  const result = assessEntryQuality(candles, "CALL", { atr: 0.0002, priceAction: action() });
  assert.equal(result.blocked, true);
  assert.ok(result.flags.includes("V1_NEAR_SWING_RESISTANCE"));
});

test("V1 blocks PUT immediately above a recent swing low without a confirmed close breakdown", () => {
  const candles = candlesWithTrend(-1);
  const prior = candles.slice(-7, -1);
  const low = Math.min(...prior.map(c => c.low));
  const last = candles.at(-1);
  last.open = low + 0.00008;
  last.close = low + 0.00002;
  last.high = last.open + 0.00001;
  last.low = low - 0.00001;
  const result = assessEntryQuality(candles, "PUT", {
    atr: 0.0002, priceAction: action({ structure: { priorTrend: "DOWN" } })
  });
  assert.equal(result.blocked, true);
  assert.ok(result.flags.includes("V1_NEAR_SWING_SUPPORT"));
});

test("V1 waits on a mature continuation run when bodies contract", () => {
  const candles = candlesWithTrend(1);
  const result = assessEntryQuality(candles, "CALL", {
    atr: 0.0002,
    priceAction: action({ exhaustion: { sameDirectionRun: 3, bodyContraction: 0.42, opposingWickRatio: 0.1 } })
  });
  assert.equal(result.blocked, true);
  assert.ok(result.flags.includes("V1_MATURE_RUN_EXHAUSTION"));
});

test("V1 allows a confirmed breakout through the opposing swing", () => {
  const candles = candlesWithTrend(1);
  const high = Math.max(...candles.slice(-7, -1).map(c => c.high));
  const last = candles.at(-1);
  last.open = high - 0.00002;
  last.close = high + 0.00008;
  last.high = last.close + 0.00001;
  last.low = last.open - 0.00001;
  const result = assessEntryQuality(candles, "CALL", { atr: 0.0002, priceAction: action() });
  assert.equal(result.blocked, false);
  assert.equal(result.confirmedBreakout, true);
});

test("V1 fails closed when entry-quality inputs are unavailable", () => {
  const result = assessEntryQuality([], "CALL", {});
  assert.equal(result.blocked, true);
  assert.equal(result.status, "UNAVAILABLE");
});
