import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("health metadata declares EUR/USD EMA5-only score-80 engine",()=>{
 assert.match(server,/decisionEngine:"EURUSD_EMA5_SCORE_80_M1"/);
 assert.match(server,/primaryDecisionEngine:"EMA5_ONLY_SCORE_THRESHOLD_80"/);
 assert.match(server,/indicators:\["EMA5"\]/);
 assert.match(server,/externalAiCalls:false/);
 assert.match(server,/watchSeconds:\[50,54\],orderSeconds:\[55,59\],orderLightSeconds:30/);
});
test("EMA5-only score is calculated from Twelve Data M1 OHLC",()=>{
 assert.match(server,/fetchCandles/);assert.match(server,/analyzeEma5Score/);assert.match(engine,/analyzeEma5Score/);
 assert.match(engine,/EMA5 score threshold 80\/100/);
 assert.doesNotMatch(server,/GEMINI_API_KEY|analyzeWithGemini|geminiQuotaStatus|Gemini/);
});
test("signal release remains manual-only with broker execution disabled",()=>{
 assert.match(server,/manualOnly:true/);assert.match(server,/brokerExecution:false/);
 assert.doesNotMatch(server,/placeBrokerOrder|executeBrokerOrder/);
});
