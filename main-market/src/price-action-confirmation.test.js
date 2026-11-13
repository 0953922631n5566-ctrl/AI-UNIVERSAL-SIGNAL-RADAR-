import test from "node:test";
import assert from "node:assert/strict";
import { analyzePriceAction } from "./price-action-confirmation.js";
import { scoreMarket } from "./advanced-scoring.js";

function risingCandles(count = 54) {
  let previous = 1.1000;
  return Array.from({ length: count }, (_, i) => {
    const open = previous;
    const close = open + 0.00008;
    previous = close;
    return { open, close, high: close + 0.00002, low: open - 0.00002, epoch: i * 60, live: false };
  });
}

test("Market Structure recognizes bullish BOS from a prior uptrend using closed candles", () => {
  const candles = risingCandles();
  const last = candles.at(-1);
  const priorSwingHigh = Math.max(...candles.slice(-7, -1).map(c => c.high));
  last.open = candles.at(-2).close;
  last.close = priorSwingHigh + 0.00010;
  last.high = last.close + 0.00002;
  last.low = last.open - 0.00002;
  const result = analyzePriceAction(candles, { ema5: last.close - 0.00005, atr: 0.0002 });
  assert.equal(result.structure.event, "BOS");
  assert.equal(result.structure.direction, "CALL");
  assert.ok(result.structure.callScore > result.structure.putScore);
});

test("Market Structure recognizes bearish CHOCH after an established uptrend breaks prior swing low", () => {
  const candles = risingCandles();
  const last = candles.at(-1);
  const priorSwingLow = Math.min(...candles.slice(-7, -1).map(c => c.low));
  last.open = candles.at(-2).close;
  last.close = priorSwingLow - 0.00010;
  last.high = last.open + 0.00002;
  last.low = last.close - 0.00002;
  const result = analyzePriceAction(candles, { ema5: last.close + 0.0001, atr: 0.0002 });
  assert.equal(result.structure.event, "CHOCH");
  assert.equal(result.structure.direction, "PUT");
});

test("Candle Confirmation scores bullish body and close near high above bearish evidence", () => {
  const candles = risingCandles();
  const last = candles.at(-1);
  last.open = 1.1000;
  last.close = 1.1008;
  last.high = 1.10082;
  last.low = 1.09998;
  const result = analyzePriceAction(candles, { ema5: 1.1004, atr: 0.0005 });
  assert.ok(result.candle.callScore > result.candle.putScore);
  assert.ok(result.candle.bodyRatio > 0.8);
});

test("Momentum Exhaustion detects extended directional run with contracting body and opposing wick", () => {
  const candles = risingCandles();
  for (let i = candles.length - 4; i < candles.length; i++) {
    const candle = candles[i];
    candle.open = 1.1 + i * 0.00008;
    candle.close = candle.open + (i === candles.length - 1 ? 0.000005 : 0.00008);
    candle.high = candle.close + (i === candles.length - 1 ? 0.00025 : 0.00001);
    candle.low = candle.open - 0.000005;
  }
  const last = candles.at(-1);
  const result = analyzePriceAction(candles, { ema5: last.close - 0.0006, atr: 0.0002 });
  assert.equal(result.exhaustion.level, "HIGH");
  assert.ok(result.exhaustion.score >= 0.70);
});

test("Price-action analysis fails closed on insufficient or invalid candles", () => {
  assert.equal(analyzePriceAction([]).ready, false);
  assert.equal(analyzePriceAction([{ open: 1, high: 1, low: 1, close: NaN }]).ready, false);
});

test("New evidence is blended into existing 30/30/20/20 components without changing thresholds", () => {
  const result = scoreMarket(risingCandles());
  assert.ok(result.priceAction?.ready);
  assert.ok(Object.hasOwn(result.metrics, "marketStructure"));
  assert.ok(Object.hasOwn(result.metrics, "candleBodyRatio"));
  assert.ok(Object.hasOwn(result.metrics, "momentumExhaustion"));
  assert.equal(Object.keys(result.componentScores.CALL).length, 4);
  assert.equal(result.thresholds.signal, 65);
  assert.equal(result.thresholds.prepare, 45);
  for (const side of ["CALL", "PUT"]) {
    const scores = result.componentScores[side];
    assert.ok(scores.ema5SlopeReversal >= 0 && scores.ema5SlopeReversal <= 30);
    assert.ok(scores.srFakeout >= 0 && scores.srFakeout <= 30);
    assert.ok(scores.proximityMomentum >= 0 && scores.proximityMomentum <= 20);
    assert.ok(scores.trendContext >= 0 && scores.trendContext <= 20);
  }
});
