import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("normal signals use the original T-5 finalization window and target the next M1 candle", () => {
  assert.match(server, /if \(!activeForCurrentOrNext && finalizeWindow && selectedFinalSignal/);
  assert.match(server, /canFinalizeSignal\(/);
  assert.match(server, /targetCandleEpoch,\s*triggeredAt: now, expiresAt: signalHoldExpiresAt\(targetCandleEpoch\)/);
  assert.doesNotMatch(server, /const recoveryStartWindow/);
  assert.doesNotMatch(server, /LIVE_TICK_AT_RECOVERY_ALERT/);
});

test("losses do not switch engines to recovery mode or borrow another analyzer", () => {
  assert.match(server, /enabled: false, mode: "DISABLED"/);
  assert.doesNotMatch(server, /const recoveryStartWindow/);
  assert.match(server, /candidates, engine, recoveryMode/);
  assert.match(server, /sourceEngine: engine, mode: "NORMAL"/);
});

test("four independent engine forecast and settlement records remain isolated", () => {
  assert.match(server, /enginePendingForecasts: \{ V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null \}/);
  assert.match(server, /engineForecastHistory: \{ V1: \[\], BB: \[\], TREND_RIDER: \[\], ENGINE_4: \[\] \}/);
});
