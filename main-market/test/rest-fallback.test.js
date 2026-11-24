import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("Twelve Data REST and Streaming remain data-only with no directional analysis", () => {
  assert.match(server, /const latestClosedCandle = feed\.candles\.filter/);
  assert.match(server, /price: freshTick \?\? restLastPrice/);
  assert.match(server, /signal: "STANDBY"/);
  assert.match(server, /status: "DISABLED"/);
  assert.match(server, /analysisMode: "NO_ANALYSIS"/);
  assert.match(server, /signalGeneration: false/);
  assert.match(server, /decisionEngine: "NONE"/);
  assert.doesNotMatch(server, /analyzeWithGemini|GEMINI_API_KEY|createNextCandleSignal/);
});
