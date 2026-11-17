import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const recovery = readFileSync(new URL("../src/recovery.js", import.meta.url), "utf8");

test("a losing engine always remains in NORMAL mode and uses its own analyzer", () => {
  assert.match(recovery, /return \{ state: \{ \.\.\.createRecoveryState\(\), lastOutcome: current\.lastOutcome \|\| null \}, mode: "NORMAL" \}/);
  assert.match(server, /const recoveryCandidate = selectRecoveryCandidate\([\s\S]*?candidates, engine, recoveryMode/);
  assert.match(server, /const selectedFinalSignal = recoveryMode === "RECOVERY_ACTIVE"[\s\S]*?: finalSignal/);
});

test("recovery start window is not enabled in the production signal pipeline", () => {
  assert.match(server, /enabled: false, mode: "DISABLED"/);
  assert.doesNotMatch(server, /const recoveryStartWindow = recoveryMode === "RECOVERY_ACTIVE"/);
});

test("each engine keeps its own original candidate in NORMAL mode", () => {
  assert.match(recovery, /if \(mode !== "RECOVERY_ACTIVE"\) return candidates\?\.\[engine\] \|\| null/);
  assert.match(server, /const selectedCandidate = recoveryCandidate \|\| candidate/);
  assert.match(server, /engineResults\[engine\] = \{/);
});
