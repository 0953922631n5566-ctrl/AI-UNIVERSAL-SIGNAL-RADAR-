import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Gemini analyzer is absent from the Main Market runtime while native scoring remains",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off|Gemini/);
 assert.match(server,/decisionEngine: "TWELVE_DATA_NATIVE_PARTIAL_SCORING_59"/);
 assert.match(server,/provider: "TWELVE_DATA_NATIVE_INDICATORS"/);
 assert.match(server,/externalAiCalls: false/);
});
