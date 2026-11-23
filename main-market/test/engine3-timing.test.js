import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Engine 3 is the only signal producer and finalizes in the T-5 window",()=>{
 assert.match(server,/analyzeTrendRider\(closed/);
 assert.match(server,/isSignalFinalizeWindow\(sourceEpoch,now\)/);
 assert.match(server,/canFinalizeSignal\(/);
 assert.match(server,/targetCandleEpoch:targetEpoch/);
 assert.match(server,/signalHoldExpiresAt\(targetEpoch\)/);
});
test("signal dispatch uses only the Trend Rider engine and never borrows another analyzer",()=>{
 assert.match(server,/engineResults:\{TREND_RIDER:engineResult\}/);
 assert.match(server,/feed\.engineActive\?\.TREND_RIDER/);
 assert.doesNotMatch(server,/engine4|ENGINE_4|V1|BB|selectRecoveryCandidate|enginePendingForecasts|engineRecoveryStates/);
});
