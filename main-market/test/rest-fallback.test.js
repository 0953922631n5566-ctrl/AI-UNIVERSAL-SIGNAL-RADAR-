import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Twelve Data REST and Streaming provide source data for native scoring",()=>{
 assert.match(server,/const latestClosedCandle = feed\.candles\.filter/);
 assert.match(server,/price: freshTick \?\? restLastPrice/);
 assert.match(server,/signal: "STANDBY"/);
 assert.match(server,/analyzeMarket\(/);
 assert.match(server,/TWELVE_DATA_NATIVE_EMA5_EMA20_ATR14/);
 assert.match(server,/signalGeneration: true/);
 assert.match(server,/decisionEngine: "TWELVE_DATA_NATIVE_PARTIAL_SCORING_59"/);
 assert.doesNotMatch(server,/analyzeWithGemini|GEMINI_API_KEY|createNextCandleSignal/);
});

test("public signal projection exposes native scores and correct M1 timing metadata",()=>{
 assert.match(server,/scores: state\.scores \|\| null/);
 assert.match(server,/analysisMode: state\.analysisMode \|\| "TWELVE_DATA_NATIVE_PARTIAL_SCORING_59"/);
 assert.match(server,/signalTimingWindowSeconds: state\.signalTimingWindowSeconds \|\| \[55, 60\]/);
 assert.match(server,/prepareTimingWindowSeconds: state\.prepareTimingWindowSeconds \|\| \[50, 55\]/);
});
