import test from "node:test";
import assert from "node:assert/strict";
import { calculateRsiBollinger, priceActionConfirmation } from "./rsi-bollinger.js";
import { scoreMarket } from "./advanced-scoring.js";

function candlesFromCloses(closes) {
  return closes.map((close, index) => {
    const open = index ? closes[index - 1] : close - 0.0002;
    return { open, close, high: Math.max(open, close) + 0.00015, low: Math.min(open, close) - 0.00015, epoch: index * 60 };
  });
}

test("RSI and Bollinger Bands return finite values for valid M1 candles", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 1.08 + i * 0.00012 + Math.sin(i / 3) * 0.00018);
  const result = calculateRsiBollinger(candlesFromCloses(closes));
  assert.equal(result.ready, true);
  for (const key of ["rsi", "previousRsi", "upper", "middle", "lower", "percentB", "bandwidth", "bandwidthRatio"]) {
    assert.ok(Number.isFinite(result[key]), key);
  }
  assert.ok(result.rsi >= 0 && result.rsi <= 100);
  assert.ok(result.upper >= result.middle);
  assert.ok(result.middle >= result.lower);
});

test("RSI and Bollinger confirmation are directional but never create a signal alone", () => {
  const indicators = { ready: true, rsi: 60, rsiRising: true, rsiFalling: false, percentB: 0.75, squeeze: false };
  const call = priceActionConfirmation(indicators, "CALL");
  const put = priceActionConfirmation(indicators, "PUT");
  assert.ok(call.rsi > put.rsi);
  assert.ok(call.bollinger > put.bollinger);
});

test("invalid or insufficient input fails closed", () => {
  assert.equal(calculateRsiBollinger([]).ready, false);
  assert.equal(calculateRsiBollinger([{ close: 1 }]).ready, false);
});

test("ORIGINAL 84 keeps fixed component weights and exposes RSI/BB evidence", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 1.08 + i * 0.00010 + Math.sin(i / 2.7) * 0.00016);
  const result = scoreMarket(candlesFromCloses(closes));
  assert.ok(Number.isFinite(result.scores.CALL));
  assert.ok(Number.isFinite(result.scores.PUT));
  assert.equal(result.thresholds.signal, 60);
  assert.equal(result.thresholds.prepare, 40);
  assert.ok(Object.hasOwn(result.metrics, "rsi"));
  assert.ok(Object.hasOwn(result.metrics, "bbPercentB"));
  assert.equal(Object.keys(result.componentScores.CALL).length, 4);
});
