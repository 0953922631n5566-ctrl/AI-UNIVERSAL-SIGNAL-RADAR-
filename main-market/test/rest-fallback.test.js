import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("REST fallback may supply candle context but never bypasses the live-tick instant-entry gate", () => {
  assert.match(server, /const restFallback=feed\.restStatus==="READY"/);
  assert.match(server, /const sourceReady=closed\.length>=MIN_CLOSED_CANDLES/);
  assert.match(server, /canTriggerLiveSignal\(\{candleEpoch:sourceEpoch,tickAt:feed\.tickAt/);
  assert.match(server, /streamingRequiredForSignals: true/);
  assert.doesNotMatch(server, /canFinalizeSignal\(\{candleEpoch:sourceEpoch/);
});
