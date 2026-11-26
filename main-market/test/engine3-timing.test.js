import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Gemini is absent and native directional scoring is enabled",()=>{
 assert.doesNotMatch(server,/analyzeWithGemini|geminiQuotaStatus|hasCriticalRiskFlags|GEMINI_API_KEY|Gemini/);
 assert.doesNotMatch(server,/action === "gemini_on"|action === "gemini_off"/);
 assert.match(server,/decisionEngine: "TWELVE_DATA_NATIVE_SCORING_65_ALL_ANALYSIS"/);
 assert.match(server,/signalGeneration: true/);
 assert.match(server,/provider: "TWELVE_DATA_NATIVE_INDICATORS"/);
 assert.match(server,/analyzeMarket\(/);
 assert.match(server,/signal: "STANDBY"/);
});
test("Twelve Data native indicators feed the single manual-only scoring engine",()=>{
 assert.match(server,/fetchCandles/);assert.match(server,/Twelve Data native EMA5\/EMA20\/ATR14/);
 assert.match(server,/TWELVE_DATA_NATIVE_EMA5_EMA20_ATR14/);
 assert.match(server,/feed\.pendingSignal = null/);
 assert.match(server,/feed\.engineActive = \{ TREND_RIDER: null \}/);
 assert.match(server,/isPrepareAlertWindow/);assert.match(server,/isSignalFinalizeWindow/);
});
