import test from "node:test";
import assert from "node:assert/strict";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED, SIGNAL_VALIDATION_STATUS } from "../src/signal-release-gate.js";

test("out-of-sample validation status is informational, not a runtime lock", () => {
  assert.equal(SIGNAL_RELEASE_VALIDATED, false);
  assert.equal(SIGNAL_VALIDATION_STATUS, "AGGRESSIVE_MOMENTUM_BREAKOUT_HIGH_RISK_MANUAL_ONLY_NOT_OOS_VALIDATED");
});

test("Adaptive EMA CALL and PUT decisions are preserved with an explicit manual-only validation note", () => {
  for (const signal of ["CALL", "PUT"]) {
    const result = applySignalReleaseGate({ signal, reason: "candidate from Adaptive EMA analyzer", evidence: ["100 closed M1 candles"], alertId: "candidate-id" });
    assert.equal(result.signal, signal);
    assert.equal(result.signalReleaseLocked, false);
    assert.equal(result.signalReleaseValidated, false);
    assert.equal(result.signalValidationStatus, SIGNAL_VALIDATION_STATUS);
    assert.equal(result.alertId, "candidate-id");
    assert.match(result.signalValidationNote, /out-of-sample/);
    assert.deepEqual(result.evidence, ["100 closed M1 candles"]);
  }
});

test("STANDBY remains STANDBY and keeps the actual analyzer reason", () => {
  const result = applySignalReleaseGate({ signal: "STANDBY", reason: "Insufficient closed M1 candles" });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.reason, "Insufficient closed M1 candles");
  assert.equal(result.signalReleaseLocked, false);
});
