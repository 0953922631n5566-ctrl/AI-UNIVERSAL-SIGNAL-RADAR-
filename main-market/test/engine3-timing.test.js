import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("Engine 3 dispatches immediately from the current live M1 candle", () => {
  assert.match(server, /analyzeTrendRider\(closed/);
  assert.match(server, /canTriggerLiveSignal\(/);
  assert.match(server, /targetCandleEpoch:sourceEpoch/);
  assert.match(server, /expiresAt:now\+30_000/);
  assert.doesNotMatch(server, /isSignalFinalizeWindow\(sourceEpoch,now\)/);
  assert.doesNotMatch(server, /signalHoldExpiresAt\(targetEpoch\)/);
});
test("signal dispatch uses only Trend Rider and one signal per M1 candle", () => {
  assert.match(server, /engineResults:\{TREND_RIDER:engineResult\}/);
  assert.match(server, /feed\.engineActive\?\.TREND_RIDER/);
  assert.match(server, /engineLastDispatchedCandle\.TREND_RIDER/);
  assert.doesNotMatch(server, /engine4|ENGINE_4|V1|BB|selectRecoveryCandidate|enginePendingForecasts|engineRecoveryStates/);
});
