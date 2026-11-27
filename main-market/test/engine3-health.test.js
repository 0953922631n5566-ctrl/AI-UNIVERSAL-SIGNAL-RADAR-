import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/custom-candle-lines-engine.js",import.meta.url),"utf8");
test("health metadata declares EUR/USD indicator-free custom candle lines",()=>{
 assert.match(server,/decisionEngine:"EURUSD_CUSTOM_CANDLE_LINES_M1"/);
 assert.match(server,/primaryDecisionEngine:"CUSTOM_PER_CANDLE_GEOMETRY_LINES_THRESHOLD_50_HIGH_FREQUENCY"/);
 assert.match(server,/lineModel:"CUSTOM_CANDLE_GEOMETRY"/);
 assert.match(server,/externalAiCalls:false/);
 assert.match(server,/watchSeconds:.*50,54.*orderSeconds:.*55,59.*orderLightSeconds:30/);
});
test("custom trigger levels are calculated only from Twelve Data M1 OHLC",()=>{
 assert.match(server,/fetchCandles/);assert.match(server,/analyzeCandleLines/);
 assert.match(engine,/export function analyzeCandleLines/);
 assert.match(engine,/findConfirmedPivots/);
 assert.match(engine,/upperTrigger/);assert.match(engine,/lowerTrigger/);
 assert.match(engine,/indicatorSource: "NONE/);
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|Gemini/);
});
test("signal release remains manual-only with broker execution disabled",()=>{
 assert.match(server,/manualOnly:true/);assert.match(server,/brokerExecution:false/);
 assert.doesNotMatch(server,/placeBrokerOrder|executeBrokerOrder/);
});
