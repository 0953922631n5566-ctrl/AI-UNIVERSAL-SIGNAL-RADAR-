import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Engines 1–3 retain T-5; Engine 4 triggers immediately after EMA5 rebound", () => {
  assert.match(server, /const engineWindow = finalizeWindow/);
  assert.match(server, /const engine4Window = engine4Entry && sourceCandleEpoch !== null/);
  assert.match(server, /engine4Entry \? engine4Window : engineWindow/);
  assert.match(server, /canFinalizeSignal\(/);
  assert.match(server, /const signalTargetEpoch = engine4Entry \? sourceCandleEpoch : targetCandleEpoch/);
  assert.match(server, /expiresAt: engine4Entry \? now \+ SIGNAL_HOLD_SECONDS \* 1000 : signalHoldExpiresAt\(signalTargetEpoch\)/);
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
