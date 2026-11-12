import test from "node:test";
import assert from "node:assert/strict";
import { calculateStructureCandleContext, calculateStructureCandleAdjustment } from "./bos-choch-candle.js";
import { scoreMarket } from "./advanced-scoring.js";

function candlesFromCloses(closes) {
  return closes.map((close, index) => {
    const open = index ? closes[index - 1] : close - 0.0002;
    return { open, close, high: Math.max(open, close) + 0.00015, low: Math.min(open, close) - 0.00015, epoch: index * 60 };
  });
}

test("BOS/CHOCH structure events actively adjust CALL and PUT scores", () => {
  const base = { ready: true, bias: "BULLISH", event: "BOS_UP", candlePattern: "NEUTRAL" };
  const call = calculateStructureCandleAdjustment(base, "CALL");
  const put = calculateStructureCandleAdjustment(base, "PUT");
  assert.equal(call.eventPoints, 5);
  assert.equal(call.biasPoints, 2);
  assert.equal(call.total, 7);
  assert.equal(put.total, -7);
  const choch = calculateStructureCandleAdjustment({ ...base, event: "CHOCH_UP" }, "CALL");
  assert.equal(choch.eventPoints, 7);
});

test("rejection and body/wick impulse confirmations actively adjust directional scores", () => {
  const bullishRejection = calculateStructureCandleAdjustment(
    { ready: true, bias: "MIXED", event: "NONE", candlePattern: "BULLISH_REJECTION" }, "CALL");
  assert.equal(bullishRejection.rejectionPoints, 6);
  assert.equal(bullishRejection.total, 6);
  const bearishImpulse = calculateStructureCandleAdjustment(
    { ready: true, bias: "MIXED", event: "NONE", candlePattern: "BEARISH_IMPULSE" }, "PUT");
  assert.equal(bearishImpulse.bodyWickPoints, 4);
  assert.equal(bearishImpulse.total, 4);
});

test("confirmed swing break is classified without look-ahead", () => {
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
  assert.equal(result.mode, "ACTIVE_SCORING");
});

test("candle shape classifies bullish rejection and bearish impulse", () => {
  const bullish = candlesFromCloses(Array.from({ length: 18 }, (_, i) => 1.1 + i * 0.00001));
  bullish[bullish.length - 1] = { open: 1.1000, close: 1.1004, high: 1.10045, low: 1.0994 };
  const bullishResult = calculateStructureCandleContext(bullish);
  assert.equal(bullishResult.candlePattern, "BULLISH_REJECTION");

  const bearish = candlesFromCloses(Array.from({ length: 18 }, (_, i) => 1.1 - i * 0.00001));
  bearish[bearish.length - 1] = { open: 1.1010, close: 1.1000, high: 1.10105, low: 1.09995 };
  const bearishResult = calculateStructureCandleContext(bearish);
  assert.equal(bearishResult.candlePattern, "BEARISH_IMPULSE");
});

test("invalid input fails closed and applies no score adjustment", () => {
  const result = calculateStructureCandleContext([]);
  assert.equal(result.ready, false);
  assert.equal(calculateStructureCandleAdjustment(result, "CALL").total, 0);
});

test("ORIGINAL 84 base score and thresholds remain separately auditable", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 1.08 + i * 0.00010 + Math.sin(i / 2.7) * 0.00016);
  const result = scoreMarket(candlesFromCloses(closes));
  assert.equal(result.thresholds.signal, 60);
  assert.equal(result.thresholds.prepare, 40);
  assert.equal(Object.keys(result.componentScores.CALL).length, 4);
  assert.ok(Number.isFinite(result.baselineScores.CALL));
  assert.ok(Number.isFinite(result.baselineScores.PUT));
  assert.equal(result.structureCandle.mode, "ACTIVE_SCORING");
  assert.deepEqual(result.scores, {
    CALL: Math.max(0, Math.min(100, result.baselineScores.CALL + result.structureCandleAdjustments.CALL.total)),
    PUT: Math.max(0, Math.min(100, result.baselineScores.PUT + result.structureCandleAdjustments.PUT.total))
  });
});
