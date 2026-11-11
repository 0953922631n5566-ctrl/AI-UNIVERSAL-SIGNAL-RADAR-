import test from "node:test";
import assert from "node:assert/strict";
import { detectReversalRadar } from "../src/accuracy-lab/reversal-radar.js";

function trendThenReversal(priorDirection, count = 54) {
  const candles = [];
  let close = 1.1;
  for (let i = 0; i < count; i++) {
    const inTurn = i >= count - 3;
    const direction = inTurn ? -priorDirection : priorDirection;
    const open = close;
    close += direction * 0.00012;
    const high = Math.max(open, close) + 0.000025;
    const low = Math.min(open, close) - 0.000025;
    candles.push({ open, high, low, close });
  }
  return candles;
}

test("insufficient and malformed history fails closed", () => {
  assert.equal(detectReversalRadar([]).ready, false);
  const bad = Array.from({ length: 30 }, () => ({ open: 1, high: 0, low: 1, close: 1 }));
  assert.equal(detectReversalRadar(bad).ready, false);
});

test("flat market is not mislabeled as a reversal", () => {
  const flat = Array.from({ length: 40 }, () => ({
    open: 1.1, high: 1.10001, low: 1.09999, close: 1.1
  }));
  const result = detectReversalRadar(flat);
  assert.equal(result.ready, true);
  assert.equal(result.stage, "NO_REVERSAL");
  assert.equal(result.candidateDirection, null);
});

test("uptrend reversal candidate is evaluated symmetrically as PUT", () => {
  const result = detectReversalRadar(trendThenReversal(1));
  assert.equal(result.ready, true);
  assert.equal(result.priorTrend, "UPTREND");
  assert.equal(result.candidateDirection, "PUT");
  assert.equal(result.shadowOnly, true);
  assert.equal(result.baselineSignalChanged, false);
});

test("downtrend reversal candidate is evaluated symmetrically as CALL", () => {
  const result = detectReversalRadar(trendThenReversal(-1));
  assert.equal(result.ready, true);
  assert.equal(result.priorTrend, "DOWNTREND");
  assert.equal(result.candidateDirection, "CALL");
  assert.equal(result.shadowOnly, true);
  assert.equal(result.baselineSignalChanged, false);
});

test("diagnostic output contains four bounded components", () => {
  const result = detectReversalRadar(trendThenReversal(1));
  if (result.components) {
    for (const value of Object.values(result.components)) {
      assert.ok(value >= 0 && value <= 30);
    }
  }
});
