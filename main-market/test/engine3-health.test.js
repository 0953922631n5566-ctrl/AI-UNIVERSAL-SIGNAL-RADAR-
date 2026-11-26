import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("health metadata declares native Twelve Data scoring and no external AI",()=>{
 assert.match(server,/decisionEngine: "TWELVE_DATA_NATIVE_SCORING_55_ALL_ANALYSIS"/);
 assert.match(server,/decisionAuthority: "DETERMINISTIC_PARTIAL_SCORING_WITH_NATIVE_INDICATORS"/);
 assert.match(server,/engines: 1/);
 assert.match(server,/provider: "TWELVE_DATA_NATIVE_INDICATORS"/);
 assert.match(server,/signalGeneration: true/);
 assert.match(server,/externalAiCalls: false/);
 assert.match(server,/callPut: 55/);
});
test("native Twelve Data indicators are the only directional data provider",()=>{
 assert.match(server,/fetchCandles/);assert.match(server,/fetchTrendEma5/);assert.match(server,/fetchEma20/);assert.match(server,/fetchAtr14/);
 assert.match(server,/TWELVE_DATA_NATIVE_EMA5_EMA20_ATR14/);
 assert.doesNotMatch(server,/GEMINI_API_KEY|analyzeWithGemini|geminiQuotaStatus|Gemini/);
});
test("signal release remains manual-only with broker execution absent",()=>{
 assert.match(server,/SIGNAL_RELEASE_VALIDATED = false/);
 assert.match(server,/recovery: \{ enabled: false, mode: "DISABLED", strategy: "NONE", martingale: false \}/);
 assert.doesNotMatch(server,/selectRecoveryCandidate|engineRecoveryStates|enginePendingForecasts|ENGINE_4|placeBrokerOrder|executeBrokerOrder/);
});
