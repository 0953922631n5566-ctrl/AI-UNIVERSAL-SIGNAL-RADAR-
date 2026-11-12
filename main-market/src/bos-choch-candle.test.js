import test from "node:test";
import assert from "node:assert/strict";
import { calculateStructureCandleContext } from "./bos-choch-candle.js";
import { scoreMarket } from "./advanced-scoring.js";

function candlesFromCloses(closes) {
  return closes.map((close, index) => {
    const open = index ? closes[index - 1] : close - 0.0002;
    return { open, close, high: Math.max(open, close) + 0.00015, low: Math.min(open, close) - 0.00015, epoch: index * 60 };
  });
}

test("BOS/CHOCH shadow context detects a close above a confirmed swing high", () => {
  const candles = Array.from({ length: 22 }, (_, i) => ({
    open: 1.1000, close: 1.1001, high: 1.1005, low: 1.0995, epoch: i * 60
  }));
  for (const [index, high, low] of [
    [4, 1.1010, 1.0990], [7, 1.1004, 1.0988],
    [10, 1.1020, 1.0992], [13, 1.1006, 1.0985],
    [16, 1.1030, 1.0994], [19, 1.1007, 1.0987]
  ]) {
    candles[index].high = high;
    candles[index].low = low;
  }
  candles[21] = { open: 1.1020, close: 1.1040, high: 1.1042, low: 1.1018, epoch: 21 * 60 };
  const result = calculateStructureCandleContext(candles);
  assert.equal(result.ready, true);
  assert.equal(result.event, "BOS_UP");
  assert.equal(result.putStructureConflict, true);
  assert.equal(result.mode, "SHADOW_ONLY");
});

test("candle confirmation identifies strong bullish and bearish impulse candles", () => {
  const bullish = candlesFromCloses(Array.from({ length: 18 }, (_, i) => 1.1 + i * 0.00001));
  bullish[bullish.length - 1] = { open: 1.1000, close: 1.1010, high: 1.10105, low: 1.09995 };
  const bullishResult = calculateStructureCandleContext(bullish);
  assert.equal(bullishResult.candlePattern, "BULLISH_IMPULSE");
  assert.equal(bullishResult.putCandleConflict, true);

  const bearish = candlesFromCloses(Array.from({ length: 18 }, (_, i) => 1.1 - i * 0.00001));
  bearish[bearish.length - 1] = { open: 1.1010, close: 1.1000, high: 1.10105, low: 1.09995 };
  const bearishResult = calculateStructureCandleContext(bearish);
  assert.equal(bearishResult.candlePattern, "BEARISH_IMPULSE");
  assert.equal(bearishResult.callCandleConflict, true);
});

test("invalid or insufficient candle input fails closed", () => {
  assert.equal(calculateStructureCandleContext([]).ready, false);
  assert.equal(calculateStructureCandleContext([{ open: 1, close: 1 }]).ready, false);
});

test("ORIGINAL 84 scores and signal remain unchanged by shadow diagnostics", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 1.08 + i * 0.00010 + Math.sin(i / 2.7) * 0.00016);
  const result = scoreMarket(candlesFromCloses(closes));
  assert.equal(result.structureCandle.mode, "SHADOW_ONLY");
  assert.equal(result.thresholds.signal, 60);
  assert.equal(result.thresholds.prepare, 40);
  assert.equal(Object.keys(result.componentScores.CALL).length, 4);
  assert.equal(result.signal, result.shadowBaselineSignal);
  assert.deepEqual(result.scores, result.shadowBaselineScores);
});
