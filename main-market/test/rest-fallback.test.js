import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("REST fallback may supply candle context but never bypasses the live-tick signal gate",()=>{
 assert.match(server,/const restFallback = feed\.restStatus === "READY"/);
 assert.match(server,/const sourceReady=closed\.length>=30&&latestAge<=MAX_CANDLE_AGE_SECONDS&&\(freshTick\|\|restFallback\)/);
 assert.match(server,/canFinalizeSignal\(\{candleEpoch:sourceEpoch,tickAt:feed\.tickAt/);
 assert.match(server,/streamingRequiredForSignals: true/);
});
