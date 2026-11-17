import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("a losing engine arms recovery for the first fresh ticks of the immediately following M1 candle", () => {
  assert.match(server, /const recoveryStartWindow = recoveryMode === "RECOVERY_ACTIVE"/);
  assert.match(server, /now - sourceCandleEpoch \* 1000 <= 10_000/);
  assert.match(server, /const signalTargetEpoch = recoveryStartWindow \? sourceCandleEpoch : targetCandleEpoch/);
  assert.match(server, /targetCandleEpoch: signalTargetEpoch/);
  assert.match(server, /entryPrice: recoveryStartWindow && Number\.isFinite\(feed\.lastTick\) \? feed\.lastTick : null/);
});

test("recovery is unlimited, uses only enabled directional analyzers, and has no fixed score threshold", () => {
  assert.match(server, /ENGINE_KEYS\.filter\(key => engineEnabled\[key\]\), null/);
  assert.match(server, /maxAttemptsPerLoss: null, maxWaitCandles: null/);
  assert.match(server, /minimumSignalScore: null/);
  assert.match(server, /if \(pending\.mode === "RECOVERY_ACTIVE"\)/);
});

test("recovery attempt outcome is measured from the actual recovery alert entry price", () => {
  assert.match(server, /evaluateM1Outcome\(pending\.signal, current, pending\.entryPrice\)/);
  assert.match(server, /entryAt: pending\.entryAt \?\? current\.epoch \* 1000/);
});

test("recovery win resets the recovering engine; other engines retain independent state", () => {
  assert.match(server, /feed\.engineRecoveryStates\[engine\] =\s*settleRecoveryAttempt/);
  assert.match(server, /feed\.engineRecoveryStates\[engine\] =\s*armRecoveryAfterLoss/);
  assert.match(server, /engineRecoveryStates: \{ V1: createRecoveryState\(\), BB: createRecoveryState\(\), TREND_RIDER: createRecoveryState\(\), ENGINE_4: createRecoveryState\(\) \}/);
});

test("an immediate recovery signal targeting the current M1 candle is exposed as active", () => {
  assert.match(server, /active\.targetCandleEpoch === sourceCandleEpoch \|\| active\.targetCandleEpoch === targetCandleEpoch/);
});
