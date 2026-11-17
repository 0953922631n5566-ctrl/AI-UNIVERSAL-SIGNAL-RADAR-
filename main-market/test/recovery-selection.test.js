import test from "node:test";
import assert from "node:assert/strict";
import { selectRecoveryCandidate } from "../src/recovery.js";

const source = (signal, score, reason = signal) => ({ signal, score, reason });

test("normal mode is not overridden by other analyzers", () => {
  const candidates = { V1: source("CALL", 62), BB: source("PUT", 98) };
  assert.equal(selectRecoveryCandidate(candidates, "V1", "NORMAL"), candidates.V1);
});

test("recovery selects the highest-scoring clear CALL/PUT candidate", () => {
  const candidates = {
    V1: source("STANDBY", 0),
    BB: source("CALL", 76),
    TREND_RIDER: source("PUT", 89),
    ENGINE_4: source("CALL", 84)
  };
  const chosen = selectRecoveryCandidate(candidates, "V1", "RECOVERY_ACTIVE");
  assert.equal(chosen.sourceEngine, "TREND_RIDER");
  assert.equal(chosen.signal, "PUT");
  assert.equal(chosen.score, 89);
});

test("recovery waits when no clear directional candidate meets threshold", () => {
  const candidates = {
    V1: source("CALL", 59),
    BB: source("STANDBY", 0),
    TREND_RIDER: source("PREPARE", 99),
    ENGINE_4: source("PUT", 40)
  };
  assert.equal(selectRecoveryCandidate(candidates, "BB", "RECOVERY_ACTIVE"), null);
});

test("disabled analyzers are excluded from recovery candidate selection", () => {
  const candidates = {
    V1: source("CALL", 99, "disabled"),
    BB: source("PUT", 80, "enabled")
  };
  const chosen = selectRecoveryCandidate(candidates, "BB", "RECOVERY_ACTIVE", ["BB"]);
  assert.equal(chosen.sourceEngine, "BB");
});

test("recovery direction is selected, never inverted automatically", () => {
  const candidates = {
    V1: source("CALL", 65),
    BB: source("PUT", 91)
  };
  assert.equal(selectRecoveryCandidate(candidates, "V1", "RECOVERY_ACTIVE").signal, "PUT");
});
