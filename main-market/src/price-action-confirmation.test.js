import test from "node:test";
import assert from "node:assert/strict";
import { analyzePriceAction } from "./price-action-confirmation.js";
import { scoreMarket, assessEntryTiming } from "./advanced-scoring.js";

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


test("three consecutive bullish candles block an unconfirmed counter-trend PUT", () => {
  const candles = risingCandles();
  const closes = candles.map(c => c.close);
  const ema5 = (() => {
    const k = 2 / 6; let value = closes[0]; const out = [value];
    for (let i = 1; i < closes.length; i++) { value = closes[i] * k + value * (1 - k); out.push(value); }
    return out;
  })();
  const last = candles.at(-1);
  const priceAction = analyzePriceAction(candles, { ema5: ema5.at(-1), atr: 0.0002 });
  const timing = assessEntryTiming(candles, "PUT", ema5, priceAction);
  assert.equal(timing.runDirection, "CALL");
  assert.ok(timing.runLength >= 3);
  assert.equal(timing.counterTrendBlocked, true);
  assert.equal(timing.allowed, false);
});

test("an early bearish micro-turn after a bullish run clears the counter-trend block", () => {
  const candles = risingCandles();
  const previous = candles.at(-2);
  const last = candles.at(-1);
  last.open = previous.close;
  last.close = previous.close - 0.00016;
  last.high = last.open + 0.00001;
  last.low = last.close - 0.00001;
  const closes = candles.map(c => c.close);
  const k = 2 / 6; let value = closes[0]; const ema5 = [value];
  for (let i = 1; i < closes.length; i++) { value = closes[i] * k + value * (1 - k); ema5.push(value); }
  const priceAction = analyzePriceAction(candles, { ema5: ema5.at(-1), atr: 0.0002 });
  const timing = assessEntryTiming(candles, "PUT", ema5, priceAction);
  assert.equal(timing.runDirection, "CALL");
  assert.ok(timing.runLength >= 3);
  assert.equal(timing.counterTrendBlocked, false);
});

test("T-5 live candidate is used only when fresh and explicitly enabled", async () => {
  const { analyzeMarket } = await import("./analyzer.js");
  const candles = risingCandles();
  const now = 54 * 60_000 + 55_000;
  const live = { open: 1.10432, high: 1.10435, low: 1.10410, close: 1.10412,
    epoch: 54 * 60, live: true };
  const enabled = await analyzeMarket([...candles, live], {
    now, tickAgeSeconds: 1, allowRestFallback: false,
    liveCandidate: live, allowLiveCandidate: true
  });
  assert.equal(enabled.analysisCandleMode, "PROVISIONAL_CURRENT_M1_AT_T_MINUS_5");
  assert.equal(enabled.analysisCandlesUsed, 55);
  const disabled = await analyzeMarket([...candles, live], {
    now, tickAgeSeconds: 1, allowRestFallback: false,
    liveCandidate: live, allowLiveCandidate: false
  });
  assert.equal(disabled.analysisCandleMode, "CLOSED_CANDLES_ONLY");
  assert.equal(disabled.analysisCandlesUsed, 54);
});
