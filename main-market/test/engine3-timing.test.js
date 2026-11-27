import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/custom-candle-lines-engine.js",import.meta.url),"utf8");
test("legacy Gemini and indicator engines are not in the active runtime",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|Gemini|analyzeMarket\(/);
 assert.match(server,/EURUSD_CUSTOM_CANDLE_LINES_M1/);assert.match(server,/analyzeCandleLines/);
});
test("Twelve Data M1 checks at T-10 and issues an order at T-5 for 30 seconds",()=>{
 assert.match(server,/runCandleLineCheck\(feed, minute, "WATCH"\)/);
 assert.match(server,/runCandleLineCheck\(feed, minute, "ORDER"\)/);
 assert.match(server,/state\.orderUntil = now \+ 30000/);
 assert.match(engine,/export function analyzeCandleLines/);
 assert.match(engine,/CANDLE_LINES_STRATEGY_ID/);
});
