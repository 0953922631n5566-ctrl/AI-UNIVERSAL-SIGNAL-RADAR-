import test from "node:test";
import assert from "node:assert/strict";
import { analyzeM5LiveM1Entry, aggregateM5 } from "../src/m5-live-m1-entry.js";

const baseEpoch = 1_800_000_000;
function rows(count = 40, direction = 1) {
  const out = [];
  let price = 1.10000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open + direction * 0.00002;
    out.push({ epoch: baseEpoch + i * 60, open, high: Math.max(open, close) + 0.00001,
      low: Math.min(open, close) - 0.00001, close, live: false });
    price = close;
  }
  return out;
}

test("M5 aggregation requires five contiguous M1 bars for a completed block", () => {
  const source = rows(12);
  const groups = aggregateM5(source);
  assert.equal(groups[0].complete, true);
  assert.equal(groups[0].count, 5);
  assert.equal(groups[2].complete, false);
});

test("analyzer refuses absent or stale live Streaming prices", () => {
  const candles = rows(40);
  candles.push({ ...candles.at(-1), epoch: candles.at(-1).epoch + 60, live: true });
  assert.equal(analyzeM5LiveM1Entry(candles, { tickAgeSeconds: null }).signal, "STANDBY");
  assert.equal(analyzeM5LiveM1Entry(candles, { tickAgeSeconds: 26 }).signal, "STANDBY");
});

test("analyzer rejects data without a current live M1 candle", () => {
  assert.equal(analyzeM5LiveM1Entry(rows(40), { tickAgeSeconds: 1 }).signal, "STANDBY");
});

test("one M5 block cannot emit more than one directional signal", () => {
  const candles = rows(40);
  const last = candles.at(-1);
  candles.push({ epoch: last.epoch + 60, open: last.close, high: last.close + 0.00003,
    low: last.close - 0.00001, close: last.close + 0.00002, live: true });
  const block = Math.floor(candles.at(-1).epoch / 300) * 300;
  const result = analyzeM5LiveM1Entry(candles, { tickAgeSeconds: 1, lastM5SignalBlock: block });
  assert.equal(result.signal, "STANDBY");
  assert.ok(result.riskFlags.includes("ONE_SIGNAL_PER_M5_BLOCK"));
});

test("result metadata identifies live Twelve Data and never reports a simulated provider", () => {
  const candles = rows(40);
  const last = candles.at(-1);
  candles.push({ epoch: last.epoch + 60, open: last.close, high: last.close + 0.00002,
    low: last.close - 0.00002, close: last.close, live: true });
  const result = analyzeM5LiveM1Entry(candles, { tickAgeSeconds: 1 });
  assert.equal(result.provider, "TWELVE_DATA_LIVE_STREAM");
  assert.equal(result.dataMode, "STREAMING");
});
