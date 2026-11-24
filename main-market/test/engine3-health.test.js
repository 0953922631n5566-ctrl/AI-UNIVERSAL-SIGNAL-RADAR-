import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("health metadata declares Gemini as the sole directional analyzer", () => {
  assert.match(server, /decisionEngine: "GEMINI_PRIMARY_ADAPTIVE_NEXT_M1"/);
  assert.match(server, /decisionAuthority: "GEMINI_PRIMARY_WITH_LOCAL_OHLC_AND_SYSTEM_TIMING_GUARDS"/);
  assert.match(server, /engines: 1/);
  assert.match(server, /fixedEngine: "GEMINI_PRIMARY"/);
  assert.match(server, /provider: "GEMINI_PRIMARY_WITH_TWELVE_DATA_M1_OHLC"/);
});
test("Gemini uses Twelve Data OHLC with local indicators and next-candle timing", () => {
  assert.match(server, /EMA9: "LOCAL_OHLC"/);
  assert.match(server, /RSI14: "LOCAL_OHLC"/);
  assert.match(server, /signalTiming: "NEXT_M1_TARGET_PREOPEN_HOLD_30S"/);
  assert.match(server, /nativeIndicatorRestCallsDisabled: true/);
  assert.match(server, /geminiDailyRequestBudget/);
  assert.match(server, /signalHoldSeconds: 30/);
  assert.match(server, /manualOnly: true/);
  assert.match(server, /brokerExecution: false/);
});
test("release remains manual-only and unvalidated until out-of-sample results exist", () => {
  assert.match(server, /SIGNAL_RELEASE_VALIDATED = false/);
  assert.match(server, /recovery: \{ enabled: false, mode: "DISABLED", strategy: "NONE", martingale: false \}/);
  assert.doesNotMatch(server, /selectRecoveryCandidate|engineRecoveryStates|enginePendingForecasts|ENGINE_4|analyzeMarket\(|analyzeBBPureScalper\(/);
});
