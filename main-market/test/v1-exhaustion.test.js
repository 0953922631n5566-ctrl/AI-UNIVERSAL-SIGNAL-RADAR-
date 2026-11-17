import test from "node:test";
import assert from "node:assert/strict";
import { scoreMarket } from "../src/advanced-scoring.js";

function exhaustionReversal(direction = "CALL", count = 54) {
  const start = Math.floor(Date.now() / 60000) * 60 - count * 60;
  const candles = [];
  let price = 1.1000;
  for (let i = 0; i < count - 4; i++) {
    const step = direction === "CALL" ? -0.00012 : 0.00012;
    const open = price;
    const close = open + step;
    candles.push({ epoch: start + i * 60, open, close,
      high: Math.max(open, close) + 0.000025,
      low: Math.min(open, close) - 0.000025, live: false });
    price = close;
  }
  const sign = direction === "CALL" ? -1 : 1;
  const bodies = [0.00010, 0.000075, 0.000045];
  for (const body of bodies) {
    const open = price;
    const close = open + sign * body;
    candles.push({ epoch: start + candles.length * 60, open, close,
      high: Math.max(open, close) + 0.00004,
      low: Math.min(open, close) - 0.00004, live: false });
    price = close;
  }
  const open = price;
  const close = open + (direction === "CALL" ? 0.00020 : -0.00020);
  candles.push({ epoch: start + candles.length * 60, open, close,
    high: Math.max(open, close) + 0.000015,
    low: Math.min(open, close) - 0.000015, live: false });
  return candles;
}

test("V1 detects a confirmed CALL after bearish candles lose momentum", () => {
  const result = scoreMarket(exhaustionReversal("CALL"));
  assert.equal(result.componentScores.CALL && result.signal, "CALL");
  assert.equal(result.metrics.v1ExhaustionEntry, true);
  assert.ok(result.componentScores.CALL.ema5SlopeReversal >= 19);
});

test("V1 detects a confirmed PUT after bullish candles lose momentum", () => {
  const result = scoreMarket(exhaustionReversal("PUT"));
  assert.equal(result.signal, "PUT");
  assert.equal(result.metrics.v1ExhaustionEntry, true);
  assert.ok(result.componentScores.PUT.ema5SlopeReversal >= 19);
});

test("V1 does not trigger exhaustion entry without a mature opposing run", () => {
  const candles = exhaustionReversal("CALL");
  candles.splice(-4, 3);
  const result = scoreMarket(candles);
  assert.equal(result.metrics.v1ExhaustionEntry, false);
});
