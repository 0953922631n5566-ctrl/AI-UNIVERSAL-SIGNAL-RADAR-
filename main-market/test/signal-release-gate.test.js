import test from "node:test";
import assert from "node:assert/strict";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED } from "../src/signal-release-gate.js";

test("directional release stays locked by default", () => {
  assert.equal(SIGNAL_RELEASE_VALIDATED, false);
});

test("CALL and PUT candidates are converted to STANDBY while validation is locked", () => {
  for (const signal of ["CALL", "PUT"]) {
    const result = applySignalReleaseGate({
      signal,
      reason: "candidate from deterministic analyzer",
      evidence: ["closed M1 candles"],
      metrics: { score: 80 },
      alertId: "must-not-escape"
    });

    assert.equal(result.signal, "STANDBY");
    assert.equal(result.signalReleaseLocked, true);
    assert.equal(result.signalReleaseValidated, false);
    assert.equal(result.alertId, null);
    assert.equal(result.preAlertSignal, null);
    assert.match(result.reason, /out-of-sample/);
    assert.match(result.reason, new RegExp(signal));
    assert.deepEqual(result.evidence, ["closed M1 candles"]);
    assert.deepEqual(result.metrics, { score: 80 });
  }
});

test("an existing STANDBY remains STANDBY and retains the analyzer reason", () => {
  const result = applySignalReleaseGate({ signal: "STANDBY", reason: "Insufficient candles" });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /Insufficient candles/);
  assert.equal(result.signalReleaseLocked, true);
});

test("directional output is preserved only when validation is explicitly approved", () => {
  const candidate = { signal: "CALL", reason: "validated test candidate", alertId: "safe-test" };
  assert.deepEqual(applySignalReleaseGate(candidate, true), candidate);
});
