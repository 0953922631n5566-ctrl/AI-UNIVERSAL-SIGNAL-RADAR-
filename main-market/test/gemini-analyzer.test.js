import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("Gemini is absent and EMA5 + RSI14 score 80 is the only active directional strategy",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off|Gemini/);
 assert.match(server,/EURUSD_EMA5_RSI14_SCORE_80_M1/);
 assert.match(server,/analyzeEma5Score/);assert.match(engine,/analyzeEma5Score/);
 assert.match(engine,/calculateRsi14/);
 assert.doesNotMatch(server,/fetchEma20|fetchAtr14|analyzeMarket\(/);
});
