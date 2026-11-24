import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("health metadata declares no analyzer and no signal generation", () => {
  assert.match(server, /decisionEngine: "NONE"/);
  assert.match(server, /decisionAuthority: "NO_AI_OR_DIRECTIONAL_ANALYSIS"/);
  assert.match(server, /engines: 0/);
  assert.match(server, /provider: "NONE"/);
  assert.match(server, /signalGeneration: false/);
  assert.match(server, /externalAiCalls: false/);
});
test("Twelve Data is retained only as market data feed", () => {
  assert.match(server, /fetchCandles/);
  assert.match(server, /TWELVE_DATA_M1_OHLC_AND_STREAMING/);
  assert.match(server, /DISABLED_NO_ANALYZER/);
  assert.doesNotMatch(server, /GEMINI_API_KEY|analyzeWithGemini|geminiQuotaStatus/);
});
test("release and broker execution remain disabled", () => {
  assert.match(server, /SIGNAL_RELEASE_VALIDATED = false/);
  assert.match(server, /recovery: \{ enabled: false, mode: "DISABLED", strategy: "NONE", martingale: false \}/);
  assert.doesNotMatch(server, /selectRecoveryCandidate|engineRecoveryStates|enginePendingForecasts|ENGINE_4|analyzeMarket\(|analyzeBBPureScalper\(/);
});
