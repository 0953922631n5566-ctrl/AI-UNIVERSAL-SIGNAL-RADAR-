import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Gemini analyzes the live source M1 candle and targets the following candle", () => {
  assert.match(server, /analyzeWithGemini\(\{ symbol: feed\.symbol, closedCandles: closed, liveCandle: current, now \}\)/);
  assert.match(server, /sourceEpoch \+ 60/);
  assert.match(server, /targetCandleEpoch: active\.targetCandleEpoch/);
  assert.match(server, /NEXT_M1_TARGET_EVERY_SOURCE_CANDLE_HOLD_30S/);
  assert.match(server, /active\.targetOpensAt/);
  assert.match(server, /active\.expiresAt/);
});
test("Gemini is opt-in and analyzes each M1 source candle without the old local prefilter/window", () => {
  assert.match(server, /let geminiEnabled = false/);
  assert.match(server, /if \(geminiEnabled && sourceReady && remainingMs > 0 && quota\.remaining > 0\)/);
  assert.match(server, /analyzeWithGemini\(\{ symbol: feed\.symbol, closedCandles: closed, liveCandle: current, now \}\)/);
  assert.doesNotMatch(server, /GEMINI_ANALYSIS_WINDOW_MS|assessGeminiSetup\(closed, current\)/);
  assert.match(server, /alreadyQueuedForTarget/);
  assert.match(server, /feed\.pendingGeminiSignal = candidate/);
  assert.match(server, /feed\.engineLastDispatchedCandle\.TREND_RIDER = active\.targetCandleEpoch/);
  assert.match(server, /lastDispatchedTargetCandle: feed\.engineLastDispatchedCandle\?\.TREND_RIDER/);
  assert.match(server, /action === "gemini_on"/);
  assert.match(server, /action === "gemini_off"/);
  assert.doesNotMatch(server, /canTriggerLiveSignal\(/);
});
test("dispatch uses one Gemini engine and no broker execution", () => {
  assert.match(server, /engineResults: \{ TREND_RIDER: engineResult \}/);
  assert.match(server, /feed\.engineActive\?\.TREND_RIDER/);
  assert.match(server, /brokerExecution: false/);
  assert.doesNotMatch(server, /engine4|ENGINE_4|V1|BB|selectRecoveryCandidate|enginePendingForecasts|engineRecoveryStates/);
});
