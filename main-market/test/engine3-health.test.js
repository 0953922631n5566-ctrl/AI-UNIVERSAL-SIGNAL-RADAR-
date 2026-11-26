import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("health metadata declares the EMA5-only two-phase engine",()=>{
 assert.match(server,/decisionEngine:"EMA5_PULLBACK_TWO_PHASE_M1"/);
 assert.match(server,/primaryDecisionEngine:"EMA5_ONLY"/);
 assert.match(server,/indicators:\["EMA5"\]/);
 assert.match(server,/externalAiCalls:false/);
 assert.match(server,/sampling:\{openSeconds:\[0,2\],prepareSeconds:\[55,59\],entrySeconds:\[0,5\],restCallsPerMinute:2\}/);
 assert.match(server,/signalPolicy:"ONE_PREPARE_AND_ONE_ENTER_PER_SOURCE_CANDLE"/);
});
test("EMA5 is the sole directional indicator and uses Twelve Data OHLC",()=>{
 assert.match(server,/fetchCandles/);
 assert.match(server,/analyzeEma5Pullback/);
 assert.match(engine,/EMA5_STRATEGY_ID/);
 assert.match(engine,/calculateEma5/);
 assert.doesNotMatch(server,/fetchTrendEma5|fetchEma20|fetchAtr14|analyzeMarket/);
 assert.doesNotMatch(server,/GEMINI_API_KEY|analyzeWithGemini|geminiQuotaStatus|Gemini/);
});
test("signal release remains manual-only with broker execution disabled",()=>{
 assert.match(server,/manualOnly:true/);
 assert.match(server,/brokerExecution:false/);
 assert.doesNotMatch(server,/placeBrokerOrder|executeBrokerOrder/);
});
