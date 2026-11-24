import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Gemini analyzes the live source M1 candle and targets the following candle", () => {
  assert.match(server, /analyzeWithGemini\(\{ symbol: feed\.symbol, closedCandles: closed, liveCandle: current, now \}\)/);
  assert.match(server, /sourceEpoch \+ 60/);
  assert.match(server, /targetCandleEpoch: active\.targetCandleEpoch/);
  assert.match(server, /NEXT_M1_TARGET_PREOPEN_HOLD_30S/);
  assert.match(server, /active\.targetOpensAt/);
  assert.match(server, /active\.expiresAt/);
});
test("Gemini requests are scheduled in the final 18 seconds and use one signal per target M1", () => {
  assert.match(server, /remainingMs <= 18_000 && remainingMs > 0/);
  assert.match(server, /engineLastDispatchedCandle\?\.TREND_RIDER !== targetEpoch/);
  assert.match(server, /lastDispatchedTargetCandle: feed\.engineLastDispatchedCandle\?\.TREND_RIDER/);
  assert.match(server, /feed\.engineLastDispatchedCandle\.TREND_RIDER = active\.targetCandleEpoch/);
  assert.doesNotMatch(server, /canTriggerLiveSignal\(/);
});
test("dispatch uses one Gemini engine and no broker execution", () => {
  assert.match(server, /engineResults: \{ TREND_RIDER: engineResult \}/);
  assert.match(server, /feed\.engineActive\?\.TREND_RIDER/);
  assert.match(server, /brokerExecution: false/);
  assert.doesNotMatch(server, /engine4|ENGINE_4|V1|BB|selectRecoveryCandidate|enginePendingForecasts|engineRecoveryStates/);
});
