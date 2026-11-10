import test from "node:test";
import assert from "node:assert/strict";
import { calculatePureTechnicalSignal } from "../src/analyzer.js";

function risingBase() {
  const nowMinute = Math.floor(Date.now() / 60000) * 60;
  const start = nowMinute - 54 * 60;
  return Array.from({ length: 54 }, (_, i) => {
    const close = 1.0800 + i * 0.0001;
    const open = close - 0.00004;
    return { epoch: start + i * 60, open, high: close + 0.00002, low: open - 0.00002, close, live: false };
  });
}

test("CALL requires EMA20 upper zone and bullish EMA5 lower-wick rejection", () => {
  const candles = risingBase();
  const prior = candles.at(-2).close;
  const close = prior + 0.00008;
  const ema5 = candles.slice(0, -1).reduce((v, c, i) => i === 0 ? c.close : c.close * (2 / 6) + v * (4 / 6), 0) * (4 / 6) + close * (2 / 6);
  candles[candles.length - 1] = {
    ...candles.at(-1), open: prior + 0.00004, low: ema5 - 0.00001,
    high: close + 0.00002, close, live: false
  };
  const result = calculatePureTechnicalSignal(candles);
  assert.equal(result.signal, "CALL");
  assert.equal(result.strategy, "EMA_5_20_WICK_REJECTION");
});

test("PUT requires EMA20 lower zone and bearish EMA5 upper-wick rejection", () => {
  const candles = risingBase().map(c => ({ ...c, open: 1.09 - (c.open - 1.08), close: 1.09 - (c.close - 1.08), high: 1.09 - (c.low - 1.08), low: 1.09 - (c.high - 1.08) }));
  const close = candles.at(-2).close - 0.00008;
  const open = candles.at(-2).close - 0.00004;
  const ema5 = candles.slice(0, -1).reduce((v, c, i) => i === 0 ? c.close : c.close * (2 / 6) + v * (4 / 6), 0) * (4 / 6) + close * (2 / 6);
  candles[candles.length - 1] = { ...candles.at(-1), open, high: ema5 + 0.00001, low: close - 0.00002, close, live: false };
  const result = calculatePureTechnicalSignal(candles);
  assert.equal(result.signal, "PUT");
});

test("no EMA5 touch or insufficient rejection wick must remain STANDBY", () => {
  const candles = risingBase();
  const last = candles.at(-1);
  candles[candles.length - 1] = { ...last, open: last.close - 0.00002, low: last.close - 0.00003, high: last.close + 0.00002, close: last.close + 0.00001 };
  assert.equal(calculatePureTechnicalSignal(candles).signal, "STANDBY");
});
