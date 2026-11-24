import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("health metadata declares one fixed Engine 3 analyzer", () => {
  assert.match(server, /decisionEngine: "ENGINE_3_TREND_RIDER_ONLY"/);
  assert.match(server, /decisionAuthority: "OUR_TREND_RIDER_FORMULA_USING_TWELVE_DATA_NATIVE_INDICATORS"/);
  assert.match(server, /engines: 1/);
  assert.match(server, /engineToggles: \{ supported: false, fixedEngine: "TREND_RIDER" \}/);
});
test("health metadata declares Twelve Data native indicators and intrabar immediate entry", () => {
  assert.match(server, /indicatorEndpoints: \["EMA time_period=5", "EMA time_period=20", "ATR time_period=14"\]/);
  assert.match(server, /signalTiming: "INTRABAR_IMMEDIATE_CURRENT_M1"/);
  assert.match(server, /minimumClosedCandles: MIN_CLOSED_CANDLES/);
  assert.match(server, /scoreBasedFiltering: false/);
  assert.match(server, /signalHoldSeconds: 30/);
  assert.match(server, /manualOnly: true/);
  assert.match(server, /brokerExecution: false/);
});
test("recovery and cross-engine signal borrowing are absent", () => {
  assert.match(server, /recovery: \{ enabled: false, mode: "DISABLED", strategy: "NONE", martingale: false \}/);
  assert.doesNotMatch(server, /selectRecoveryCandidate|engineRecoveryStates|enginePendingForecasts|ENGINE_4|analyzeMarket\(|analyzeBBPureScalper\(/);
});
