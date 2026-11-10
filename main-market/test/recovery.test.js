import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryState, evaluateM1Outcome, armRecoveryAfterLoss, inspectRecoveryWindow,
  markRecoveryAttempt, settleRecoveryAttempt, RECOVERY_POLICY } from "../src/recovery.js";

function candle(open, close) {
  return { epoch: 1_800_000_000, open, high: Math.max(open, close) + 0.0001,
    low: Math.min(open, close) - 0.0001, close, live: false };
}

test("M1 outcome uses candle OPEN and CLOSE for CALL and PUT symmetrically", () => {
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.1002)).outcome, "WIN");
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.0998)).outcome, "LOSS");
  assert.equal(evaluateM1Outcome("PUT", candle(1.1, 1.0998)).outcome, "WIN");
  assert.equal(evaluateM1Outcome("PUT", candle(1.1, 1.1002)).outcome, "LOSS");
});

test("equal open and close is FLAT, while invalid OHLC is UNKNOWN", () => {
  assert.equal(evaluateM1Outcome("CALL", candle(1.1, 1.1)).outcome, "FLAT");
  const malformed = candle(1.1, 1.1002); malformed.low = 1.1003;
  assert.equal(evaluateM1Outcome("PUT", malformed).outcome, "UNKNOWN");
  assert.equal(evaluateM1Outcome("WAIT", candle(1.1, 1.1002)).outcome, "UNKNOWN");
});

test("only a normal LOSS arms one shadow recovery window", () => {
  const initial = createRecoveryState();
  const armed = armRecoveryAfterLoss(initial, { alertId: "normal-loss",
    targetCandleEpoch: 1_800_000_000, outcome: "LOSS", mode: "NORMAL" });
  assert.equal(armed.status, "ARMED");
  assert.equal(armed.expiresAtCandleEpoch, 1_800_000_180);
  assert.equal(armRecoveryAfterLoss(initial, { alertId: "normal-win",
    targetCandleEpoch: 1_800_000_000, outcome: "WIN", mode: "NORMAL" }).status, "IDLE");
  assert.equal(armRecoveryAfterLoss(initial, { alertId: "recovery-loss",
    targetCandleEpoch: 1_800_000_000, outcome: "LOSS", mode: "RECOVERY_SHADOW" }).status, "IDLE");
});

test("recovery waits for a fresh valid T-5 candidate and expires after three M1 windows", () => {
  const armed = armRecoveryAfterLoss(createRecoveryState(), { alertId: "loss",
    targetCandleEpoch: 1_800_000_000, outcome: "LOSS", mode: "NORMAL" });
  assert.equal(inspectRecoveryWindow(armed, 1_800_000_060).mode, "RECOVERY_SHADOW");
  assert.equal(inspectRecoveryWindow(armed, 1_800_000_120).mode, "RECOVERY_SHADOW");
  assert.equal(inspectRecoveryWindow(armed, 1_800_000_180).mode, "RECOVERY_SHADOW");
  const expired = inspectRecoveryWindow(armed, 1_800_000_240);
  assert.equal(expired.mode, "NORMAL");
  assert.equal(expired.state.status, "IDLE");
  assert.equal(expired.state.lastOutcome, "EXPIRED");
});

test("one shadow attempt is marked once and any final outcome closes recovery without rearming", () => {
  const armed = armRecoveryAfterLoss(createRecoveryState(), { alertId: "loss",
    targetCandleEpoch: 1_800_000_000, outcome: "LOSS", mode: "NORMAL" });
  const pending = markRecoveryAttempt(armed, { alertId: "recovery-1", signalAt: 123 });
  assert.equal(pending.status, "ATTEMPT_PENDING");
  assert.equal(markRecoveryAttempt(pending, { alertId: "recovery-2" }).attemptAlertId, "recovery-1");
  for (const outcome of ["WIN", "LOSS", "FLAT", "UNKNOWN"]) {
    const settled = settleRecoveryAttempt(pending, { alertId: "recovery-1", outcome });
    assert.equal(settled.status, "IDLE");
    assert.equal(settled.lastOutcome, outcome);
    assert.equal(armRecoveryAfterLoss(settled, { alertId: "recovery-1",
      targetCandleEpoch: 1_800_000_060, outcome: "LOSS", mode: "RECOVERY_SHADOW" }).status, "IDLE");
  }
});

test("policy is shadow-only, one attempt, one-minute expiry, no Martingale", () => {
  assert.deepEqual(RECOVERY_POLICY, { mode: "SHADOW_ONLY", expiryMinutes: 1,
    maxAttemptsPerLoss: 1, maxWaitCandles: 3, martingale: false, minimumScore: 65 });
});
