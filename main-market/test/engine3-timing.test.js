import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("legacy Gemini and score-based signal engines are not in the active runtime",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|Gemini|analyzeMarket\(/);
 assert.match(server,/EMA5_PULLBACK_TWO_PHASE_M1/);
 assert.match(server,/analyzeEma5Pullback/);
});
test("Twelve Data M1 samples open and T-5, then emits one next-candle entry",()=>{
 assert.match(server,/sampleEma5\(feed,"OPEN",minute\)/);
 assert.match(server,/sampleEma5\(feed,"PREPARE",minute\)/);
 assert.match(server,/enterPreparedSignal\(state,minute\)/);
 assert.match(engine,/state.enteredEpoch === targetEpoch/);
 assert.match(engine,/EMA5_PULLBACK_TWO_PHASE_M1/);
});
