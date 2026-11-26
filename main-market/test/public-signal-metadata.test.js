import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("public signal metadata identifies EUR/USD EMA5 + local S/R",()=>{
 assert.match(server,/analysisMode: "EMA5_PULLBACK_SR_TWO_PHASE_M1"/);
 assert.match(server,/Twelve Data M1 OHLC · EMA5 \+ local swing Support\/Resistance/);
 assert.match(server,/signalReleaseStatus: "EURUSD_EMA5_PULLBACK_SR_TWO_PHASE_M1_MANUAL_ONLY_NOT_OOS_VALIDATED"/);
});
test("public signal advertises the exact open, prepare and next-candle windows",()=>{
 assert.match(server,/signalTimingWindowSeconds: \[0, 5\]/);
 assert.match(server,/prepareTimingWindowSeconds: \[55, 60\]/);
 assert.match(server,/NEXT_M1_OPEN_00_05_AFTER_PREPARE_55_59/);
});
