import test from "node:test";
import assert from "node:assert/strict";
import { assessBullishReversalRisk } from "../src/early-bullish-reversal-shadow.js";
import { scoreMarket } from "../src/advanced-scoring.js";

function makeDowntrend(count = 54) {
  const candles = [];
  let close = 1.1100;
  for (let i = 0; i < count; i++) {
    const open = close;
    close -= 0.00010;
    candles.push({
      epoch: 1_800_000_000 + i * 60,
      open, close,
      high: open + 0.00002,
      low: close - 0.00002,
      live: false
    });
  }
  return candles;
}

function bearishMoveWithBullishRejection() {
  const candles = makeDowntrend();
  const previous = candles.at(-2);
  const last = candles.at(-1);
  last.open = previous.close;
  last.close = last.open - 0.000015; // still a red candle at the decision point
  last.low = last.close - 0.00011;   // strong lower-wick rejection
  last.high = last.open + 0.00001;
  return candles;
}

test("shadow detector flags a weakening bearish move with strong lower-wick rejection", () => {
  const result = assessBullishReversalRisk(bearishMoveWithBullishRejection());
  assert.equal(result.ready, true);
  assert.equal(result.wouldBlockPut, true);
  assert.equal(result.mode, "OBSERVE_ONLY");
  assert.ok(result.bearishRun >= 2);
  assert.equal(result.bullishRejection, true);
  assert.equal(result.bodyContraction, true);
});

test("shadow detector does not flag a strong bearish continuation", () => {
  const result = assessBullishReversalRisk(makeDowntrend());
  assert.equal(result.wouldBlockPut, false);
  assert.equal(result.bullishRejection, false);
});

test("one bullish-looking wick alone is not enough to flag a PUT block", () => {
  const candles = makeDowntrend();
  const previous = candles.at(-2);
  const last = candles.at(-1);
  last.open = previous.close;
  last.close = last.open - 0.00010;
  last.low = last.close - 0.00010;
  last.high = last.open + 0.00001;
  const result = assessBullishReversalRisk(candles);
  assert.equal(result.bullishRejection, true);
  assert.equal(result.bodyContraction, false);
  assert.equal(result.wouldBlockPut, false);
});

test("shadow detector fails safely on incomplete or invalid OHLC", () => {
  assert.equal(assessBullishReversalRisk([]).wouldBlockPut, false);
  const candles = makeDowntrend();
  candles.at(-1).low = candles.at(-1).high + 1;
  const result = assessBullishReversalRisk(candles);
  assert.equal(result.ready, false);
  assert.equal(result.level, "UNKNOWN");
});

test("scoring integration exposes shadow diagnostics without adding a new signal veto", () => {
  const candles = bearishMoveWithBullishRejection();
  const result = scoreMarket(candles);
  assert.equal(result.shadowEntryGuard.mode, "OBSERVE_ONLY");
  assert.equal(result.shadowEntryGuard.wouldBlockPut, true);
  assert.equal(result.riskFlags.includes("EARLY_BULLISH_REVERSAL_SHADOW"), false);
  assert.ok(["CALL", "PUT", "PREPARE", "STANDBY"].includes(result.signal));
  assert.equal(result.thresholds.signal, 65);
  assert.equal(result.thresholds.prepare, 45);
});
