import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStrictTrendRider } from "../src/engine-four.js";

function candles(direction = "up", count = 48) {
  return Array.from({ length: count }, (_, i) => {
    const close = direction === "up" ? 1.1 + i * 0.0002
      : direction === "down" ? 1.11 - i * 0.0002 : 1.105;
    const open = direction === "up" ? close - 0.00015
      : direction === "down" ? close + 0.00015 : close;
    return { epoch: 1_800_000_000 + i * 60, open,
      high: Math.max(open, close) + 0.00005,
      low: Math.min(open, close) - 0.00005, close, live: false };
  });
}

test("Engine 4 is a stricter independent copy of Trend Rider and confirms aligned CALL/PUT", () => {
  for (const direction of ["up", "down"]) {
    const rows = candles(direction);
    const result = analyzeStrictTrendRider(rows);
    assert.equal(result.ready, true);
    assert.ok(["CALL", "PUT"].includes(result.signal), JSON.stringify(result));
    assert.equal(result.signal, direction === "up" ? "CALL" : "PUT");
    assert.ok(result.score >= 75);
    assert.ok(Math.abs(result.scoreUp - result.scoreDown) >= 18);
    assert.match(result.strategy, /STRICT_COPY_OF_TREND_RIDER/);
    assert.ok(result.alertId.startsWith("ENGINE_4:"));
    assert.equal(result.candleEpoch, rows.at(-1).epoch);
  }
});

test("Engine 4 blocks sideways and weak candles instead of forcing a direction", () => {
  const result = analyzeStrictTrendRider(candles("flat"));
  assert.equal(result.ready, true);
  assert.equal(result.signal, null);
  assert.equal(result.status, "SIDEWAYS_BLOCK");
});

test("Engine 4 requires 35 valid closed M1 candles and rejects live or malformed candles", () => {
  assert.equal(analyzeStrictTrendRider([]).ready, false);
  assert.equal(analyzeStrictTrendRider(candles("up", 34)).ready, false);
  const live = candles("up");
  live[live.length - 1].live = true;
  assert.equal(analyzeStrictTrendRider(live).ready, false);
  const malformed = candles("up");
  malformed[47] = { ...malformed[47], high: 1.0 };
  assert.equal(analyzeStrictTrendRider(malformed).ready, false);
});

test("Engine 4 target timing and alert identity are tied to the latest closed M1 candle", () => {
  const rows = candles("up");
  const first = analyzeStrictTrendRider(rows);
  assert.equal(first.targetCandleAt, new Date((rows.at(-1).epoch + 120) * 1000).toISOString());
  rows.push({ epoch: rows.at(-1).epoch + 60, open: 1.1093, high: 1.1095, low: 1.1092, close: 1.10945, live: false });
  const second = analyzeStrictTrendRider(rows);
  assert.notEqual(first.alertId, second.alertId);
});
