import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/custom-candle-lines-engine.js",import.meta.url),"utf8");
test("Gemini and technical indicators are absent from the active custom line decision path",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off|Gemini/);
 assert.match(server,/EURUSD_CUSTOM_CANDLE_LINES_M1/);
 assert.match(server,/analyzeCandleLines/);assert.match(engine,/analyzeCandleLines/);
 assert.match(engine,/indicatorSource: "NONE/);
 assert.doesNotMatch(server,/fetchEma20|fetchAtr14|analyzeMarket\(/);
});
