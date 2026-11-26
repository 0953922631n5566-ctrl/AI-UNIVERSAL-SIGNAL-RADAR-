import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("health metadata declares EUR/USD MA5 + Bollinger Bands(20,2) engine",()=>{
 assert.match(server,/decisionEngine:"EURUSD_MA5_BOLLINGER_20_2_M1"/);
 assert.match(server,/primaryDecisionEngine:"SMA5_PLUS_BOLLINGER_BANDS_20_2"/);
 assert.match(server,/indicators:\["SMA5","BOLLINGER_BANDS_20_2"\]/);
 assert.match(server,/externalAiCalls:false/);
 assert.match(server,/watchSeconds:\[50,54\],orderSeconds:\[55,59\],orderLightSeconds:30/);
});
test("MA5 and Bollinger Bands are calculated from Twelve Data M1 OHLC",()=>{
 assert.match(server,/fetchCandles/);assert.match(server,/analyzeMa5Bollinger/);assert.match(engine,/analyzeMa5Bollinger/);
 assert.match(engine,/Bollinger Bands\(20,2\)/);
 assert.doesNotMatch(server,/GEMINI_API_KEY|analyzeWithGemini|geminiQuotaStatus|Gemini/);
});
test("signal release remains manual-only with broker execution disabled",()=>{
 assert.match(server,/manualOnly:true/);assert.match(server,/brokerExecution:false/);
 assert.doesNotMatch(server,/placeBrokerOrder|executeBrokerOrder/);
});
