import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/ema5-two-phase-engine.js",import.meta.url),"utf8");
test("legacy Gemini and score-based signal engines are not in the active runtime",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|Gemini|analyzeMarket\(/);
 assert.match(server,/EURUSD_EMA5_RSI14_SCORE_80_M1/);assert.match(server,/analyzeEma5Score/);
});
test("Twelve Data M1 checks at T-10 and issues an order at T-5 for 30 seconds",()=>{
 assert.match(server,/runEma5ScoreCheck\(feed, minute, "WATCH"\)/);
 assert.match(server,/runEma5ScoreCheck\(feed, minute, "ORDER"\)/);
 assert.match(server,/state\.orderUntil = now \+ 30000/);
 assert.match(engine,/export function analyzeEma5Score/);
 assert.match(engine,/export function calculateRsi14/);
});
