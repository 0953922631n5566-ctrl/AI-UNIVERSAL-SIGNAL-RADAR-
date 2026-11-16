import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEveryCandle } from "../src/engine-four.js";

function candles(direction = "up", count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const close = direction === "up" ? 1.1 + i * 0.0002
      : direction === "down" ? 1.105 - i * 0.0002 : 1.102;
    const open = direction === "flat" ? close : close + (direction === "up" ? -0.00005 : 0.00005);
    return { epoch: 1_800_000_000 + i * 60, open, high: Math.max(open, close) + 0.0001,
      low: Math.min(open, close) - 0.0001, close, live: false };
  });
}

test("Engine 4 independently emits a direction on every valid closed candle", () => {
  for (const direction of ["up", "down"]) {
    const result = analyzeEveryCandle(candles(direction));
    assert.equal(result.ready, true);
    assert.ok(["CALL", "PUT"].includes(result.signal));
    assert.equal(result.status, "EVERY_CANDLE_SIGNAL");
    assert.ok(result.score >= 20);
    assert.ok(result.alertId.startsWith("ENGINE_4:"));
  }
});

test("Engine 4 advances its signal identity with each newly closed candle", () => {
  const rows = candles("up");
  const first = analyzeEveryCandle(rows);
  rows.push({ epoch: rows.at(-1).epoch + 60, open: 1.1045, high: 1.1048, low: 1.1043, close: 1.1044, live: false });
  const second = analyzeEveryCandle(rows);
  assert.notEqual(first.alertId, second.alertId);
  assert.equal(second.candleEpoch, rows.at(-1).epoch);
});

test("Engine 4 refuses missing, malformed, or insufficient candle data", () => {
  assert.equal(analyzeEveryCandle([]).ready, false);
  assert.equal(analyzeEveryCandle(candles("up").slice(0, 19)).ready, false);
  const malformed = candles("up");
  malformed[23] = { ...malformed[23], high: 1.0 };
  assert.equal(analyzeEveryCandle(malformed).ready, false);
});


test("Engine 4 requires a minimum directional score of 20 before emitting CALL or PUT", () => {
  const rows = candles("flat");
  const result = analyzeEveryCandle(rows);
  assert.equal(result.ready, true);
  assert.equal(result.status, "BELOW_THRESHOLD");
  assert.equal(result.signal, null);
  assert.ok(result.score < 20);
  assert.match(result.reason, /ต่ำกว่าเกณฑ์ 20\/100/);
});


test("Engine 4 signal target aligns with the shared countdown for the candle after the currently forming candle", () => {
  const rows = candles("up");
  const result = analyzeEveryCandle(rows);
  assert.equal(result.targetCandleAt, new Date((rows.at(-1).epoch + 120) * 1000).toISOString());
});
