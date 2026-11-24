import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Gemini analyzer is absent from the Main Market runtime",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|GEMINI_API_KEY|gemini_on|gemini_off/);
 assert.match(server,/decisionEngine: "NONE"/);
 assert.match(server,/externalAiCalls: false/);
});
