import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("Gemini is absent and EMA5 is the only active directional indicator",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off|Gemini/);
 assert.match(server,/EURUSD_EMA5_PULLBACK_SR_TWO_PHASE_M1/);
 assert.match(engine,/calculateEma5/);
 assert.doesNotMatch(server,/fetchEma20|fetchAtr14|analyzeMarket\(/);
});
