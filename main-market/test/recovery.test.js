import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryState, evaluateM1Outcome, armRecoveryAfterLoss, inspectRecoveryWindow,
  markRecoveryAttempt, settleRecoveryAttempt, RECOVERY_POLICY } from "../src/recovery.js";

function candle(open, close) {
  return { epoch: 1_800_000_000, open, high: Math.max(open, close) + 0.0001,
    low: Math.min(open, close) - 0.0001, close, live: false };
}

test("M1 outcome uses candle OPEN and CLOSE symmetrically", () => {
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.1002)).outcome, "WIN");
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.0998)).outcome, "LOSS");
  assert.equal(evaluateM1Outcome("PUT", candle(1.1, 1.0998)).outcome, "WIN");
  assert.equal(evaluateM1Outcome("PUT", candle(1.1, 1.1002)).outcome, "LOSS");
});

test("equal open and close is FLAT; malformed OHLC is UNKNOWN", () => {
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.1)).outcome, "FLAT");
  const malformed = candle(1.1, 1.1002); malformed.low = 1.1003;
  assert.equal(evaluateM1Outcome("PUT", malformed).outcome, "UNKNOWN");
  assert.equal(evaluateM1Outcome("WAIT", candle(1.1, 1.1002)).outcome, "UNKNOWN");
});

test("a LOSS is recorded but never switches an engine out of its original analyzer", () => {
  const armed = armRecoveryAfterLoss(createRecoveryState(), {
    alertId: "loss-1", targetCandleEpoch: 1_800_000_000, outcome: "LOSS", mode: "NORMAL"
  });
  assert.equal(armed.status, "ARMED");
  assert.equal(inspectRecoveryWindow(armed, 1_800_000_060).mode, "NORMAL");
  assert.equal(armRecoveryAfterLoss(armed, { outcome: "WIN", targetCandleEpoch: 1_800_000_060 }).status, "ARMED");
});

test("recovery keeps analyzing later M1 candles after consecutive losses", () => {
  let state = armRecoveryAfterLoss(createRecoveryState(), {
    alertId: "normal-loss", targetCandleEpoch: 1_800_000_000, outcome: "LOSS"
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pending = markRecoveryAttempt(state, { alertId: "recovery-" + attempt, signalAt: attempt });
    assert.equal(pending.status, "ATTEMPT_PENDING");
    assert.equal(pending.attempts, attempt);
    state = settleRecoveryAttempt(pending, { alertId: "recovery-" + attempt, outcome: "LOSS" });
    assert.equal(state.status, "ARMED");
    assert.equal(inspectRecoveryWindow(state, 1_800_000_000 + attempt * 60).mode, "NORMAL");
  }
  assert.equal(state.attempts, 3);
});

test("a recovery WIN returns to normal mode and resets attempt count", () => {
  const armed = armRecoveryAfterLoss(createRecoveryState(), {
    alertId: "loss", targetCandleEpoch: 1_800_000_000, outcome: "LOSS"
  });
  const pending = markRecoveryAttempt(armed, { alertId: "recovery-win", signalAt: 123 });
  const settled = settleRecoveryAttempt(pending, { alertId: "recovery-win", outcome: "WIN" });
  assert.equal(settled.status, "IDLE");
  assert.equal(settled.lastOutcome, "WIN");
  assert.equal(settled.attempts, 0);
  assert.equal(inspectRecoveryWindow(settled, 1_800_000_060).mode, "NORMAL");
});

test("FLAT and UNKNOWN keep recovery armed without reversing the signal", () => {
  for (const outcome of ["FLAT", "UNKNOWN"]) {
    const armed = armRecoveryAfterLoss(createRecoveryState(), {
      alertId: "loss", targetCandleEpoch: 1_800_000_000, outcome: "LOSS"
    });
    const pending = markRecoveryAttempt(armed, { alertId: "retry", signalAt: 123 });
    const settled = settleRecoveryAttempt(pending, { alertId: "retry", outcome });
    assert.equal(settled.status, "ARMED");
    assert.equal(settled.lastOutcome, outcome);
  }
});

test("recovery policy never uses Martingale and delegates direction to original engine", () => {
  assert.equal(RECOVERY_POLICY.martingale, false);
  assert.equal(RECOVERY_POLICY.strategy, "REANALYZE_WITH_ORIGINAL_ENGINE_EACH_NEXT_M1");
  assert.equal(RECOVERY_POLICY.maxAttemptsPerLoss, null);
});

test("recovery outcome uses the actual alert entry price within the target M1 candle", () => {
  const bar = { epoch: 1_800_000_000, open: 1.1, high: 1.101, low: 1.099, close: 1.1005 };
  assert.equal(evaluateM1Outcome("CALL", bar, 1.1002).outcome, "WIN");
  assert.equal(evaluateM1Outcome("PUT", bar, 1.1002).outcome, "LOSS");
  assert.equal(evaluateM1Outcome("CALL", bar, 1.1008).outcome, "LOSS");
});

test("recovery mode always stays disabled after a loss", () => { const armed = armRecoveryAfterLoss(createRecoveryState(), { alertId: "loss", targetCandleEpoch: 1_800_000_000, outcome: "LOSS" }); assert.equal(inspectRecoveryWindow(armed, 1_800_000_060).mode, "NORMAL"); });
