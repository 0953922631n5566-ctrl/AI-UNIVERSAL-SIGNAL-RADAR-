import test from "node:test";
import assert from "node:assert/strict";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED, SIGNAL_VALIDATION_STATUS } from "../src/signal-release-gate.js";

test("M1 Precision Entry validation status is informational, not a runtime lock", () => {
  assert.equal(SIGNAL_RELEASE_VALIDATED, false);
  assert.equal(SIGNAL_VALIDATION_STATUS, "M1_PRECISION_ENTRY_80_60_MARGIN_12_MANUAL_ONLY_NOT_OOS_VALIDATED");
});

test("M1 Precision Entry CALL and PUT decisions are preserved with an explicit validation note", () => {
  for (const signal of ["CALL", "PUT"]) {
    const result = applySignalReleaseGate({ signal, reason: "candidate from ORIGINAL 84", evidence: ["54 closed M1 candles"], alertId: "candidate-id" });
    assert.equal(result.signal, signal);
    assert.equal(result.signalReleaseLocked, false);
    assert.equal(result.signalReleaseValidated, false);
    assert.equal(result.signalValidationStatus, SIGNAL_VALIDATION_STATUS);
    assert.equal(result.alertId, "candidate-id");
    assert.match(result.signalValidationNote, /ORIGINAL 84/);
    assert.match(result.signalValidationNote, /EMA5 slope\/reversal/);
    assert.match(result.signalValidationNote, /S\/R fakeout/);
    assert.match(result.signalValidationNote, /60\/40/);
    assert.match(result.signalValidationNote, /out-of-sample/);
    assert.deepEqual(result.evidence, ["54 closed M1 candles"]);
  }
});

test("STANDBY remains STANDBY and keeps the actual analyzer reason", () => {
  const result = applySignalReleaseGate({ signal: "STANDBY", reason: "Insufficient closed M1 candles" });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.reason, "Insufficient closed M1 candles");
  assert.equal(result.signalReleaseLocked, false);
});
