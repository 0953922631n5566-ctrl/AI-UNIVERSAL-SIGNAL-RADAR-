import test from "node:test";
import assert from "node:assert/strict";
import { calculatePureTechnicalSignal } from "../src/analyzer.js";

function trendCandles(direction) {
  const nowMinute = Math.floor(Date.now() / 60000) * 60;
  const start = nowMinute - 54 * 60;
  return Array.from({ length: 54 }, (_, i) => {
    const close = 1.0800 + direction * i * 0.00004;
    const open = close - direction * 0.00002;
    return {
      epoch: start + i * 60,
      open,
      high: Math.max(open, close) + 0.00004,
      low: Math.min(open, close) - 0.00004,
      close,
      live: false
    };
  });
}

test("CALL accepts bullish EMA5-only trend flow without EMA20 gating", () => {
  const result = calculatePureTechnicalSignal(trendCandles(1));
  assert.equal(result.signal, "CALL");
  assert.equal(result.strategy, "EMA5_ONLY_TREND_FLOW");
  assert.equal(result.metrics.aboveEma5, true);
  assert.equal(result.metrics.ema5Rising, true);
});

test("PUT accepts bearish EMA5-only trend flow without EMA20 gating", () => {
  const result = calculatePureTechnicalSignal(trendCandles(-1));
  assert.equal(result.signal, "PUT");
  assert.equal(result.strategy, "EMA5_ONLY_TREND_FLOW");
  assert.equal(result.metrics.aboveEma5, true);
  assert.equal(result.metrics.ema5Rising, true);
});

test("EMA5 position and trend flow are sufficient even when price is far from EMA5", () => {
  const candles = trendCandles(1);
  const last = candles.at(-1);
  const prior = candles.at(-2);
  candles[candles.length - 1] = {
    ...last,
    open: prior.close + 0.0005,
    close: prior.close + 0.0007,
    high: prior.close + 0.00072,
    low: prior.close + 0.00048,
    live: false
  };
  const result = calculatePureTechnicalSignal(candles);
  assert.equal(result.signal, "CALL");
  assert.equal(result.metrics.aboveEma5, true);
  assert.equal(result.metrics.ema5Rising, true);
});
