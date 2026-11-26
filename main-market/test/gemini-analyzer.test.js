import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("Gemini is absent and MA5 Bollinger is the only active directional indicator",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off|Gemini/);
 assert.match(server,/EURUSD_MA5_BOLLINGER_20_2_M1/);
 assert.match(server,/analyzeMa5Bollinger/);assert.match(engine,/analyzeMa5Bollinger/);
 assert.doesNotMatch(server,/fetchEma20|fetchAtr14|analyzeMarket\(/);
});
