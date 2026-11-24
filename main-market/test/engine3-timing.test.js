import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("Gemini analysis and directional signal generation are fully disabled", () => {
  assert.doesNotMatch(server, /analyzeWithGemini|geminiQuotaStatus|hasCriticalRiskFlags/);
  assert.doesNotMatch(server, /action === "gemini_on"|action === "gemini_off"/);
  assert.match(server, /decisionEngine: "NONE"/);
  assert.match(server, /signalGeneration: false/);
  assert.match(server, /provider: "NONE"/);
  assert.match(server, /signal: "STANDBY"/);
  assert.match(server, /DISABLED_NO_ANALYZER/);
});
test("Twelve Data remains only as market data feed; no CALL/PUT can be produced", () => {
  assert.match(server, /fetchCandles/);
  assert.match(server, /Twelve Data M1 OHLC \+ Streaming/);
  assert.match(server, /NO_AI_OR_DIRECTIONAL_ANALYSIS/);
  assert.match(server, /feed\.pendingGeminiSignal = null/);
  assert.match(server, /feed\.engineActive = \{ TREND_RIDER: null \}/);
});
