import test from "node:test";
import assert from "node:assert/strict";
import { assessEntryTiming } from "./entry-timing.js";

function risingCandles(count = 12) {
  let previous = 1.1000;
  return Array.from({ length: count }, () => {
    const open = previous;
    const close = open + 0.0001;
    previous = close;
    return { open, close, high: close + 0.00002, low: open - 0.00002 };
  });
}

test("V1 waits instead of chasing a mature, extended bullish run", () => {
  const candles = risingCandles();
  const last = candles.at(-1);
  const result = assessEntryTiming(candles, "CALL", {
    ema5: last.close - 0.0002, atr: 0.00012, exhaustionScore: 0.42
  });
  assert.equal(result.status, "WAIT_FOR_PULLBACK");
  assert.equal(result.waitForPullback, true);
  assert.ok(result.extensionAtr >= 1.25);
});

test("V1 keeps a fresh pullback/reversal near EMA5 eligible", () => {
  const candles = risingCandles();
  const previous = candles.at(-2).close;
  candles.push({
    open: previous + 0.00002, close: previous + 0.00008,
    high: previous + 0.00010, low: previous - 0.00003
  });
  const last = candles.at(-1);
  const result = assessEntryTiming(candles, "CALL", {
    ema5: last.close - 0.00002, atr: 0.00015, exhaustionScore: 0.1
  });
  assert.equal(result.status, "READY");
  assert.equal(result.waitForPullback, false);
});

test("V1 does not mistake an opposite-direction move for a late continuation entry", () => {
  const candles = risingCandles();
  const last = candles.at(-1);
  const result = assessEntryTiming(candles, "PUT", {
    ema5: last.close + 0.0002, atr: 0.00012, exhaustionScore: 0.9
  });
  assert.equal(result.status, "READY");
});

test("Entry timing fails closed when the ATR or candle data is unavailable", () => {
  const candles = risingCandles();
  assert.equal(assessEntryTiming(candles, "CALL", { ema5: 1.1, atr: 0 }).status, "UNAVAILABLE");
});
