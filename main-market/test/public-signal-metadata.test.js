import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("public signal metadata identifies EUR/USD EMA5 + RSI14 score threshold 80",()=>{
 assert.match(server,/analysisMode: "EMA5_RSI14_SCORE_80_M1"/);
 assert.match(server,/indicatorSource: "Twelve Data real M1 OHLC · EMA5 \+ RSI\(14\) · score threshold 80\/100"/);
 assert.match(server,/signalReleaseStatus: "EURUSD_EMA5_RSI14_SCORE_80_M1_MANUAL_ONLY_NOT_OOS_VALIDATED"/);
});
test("public signal advertises the 10-second watch, final-5-second order and 30-second lamp",()=>{
 assert.match(server,/watchSeconds:\[50,54\]/);
 assert.match(server,/orderSeconds:\[55,59\]/);
 assert.match(server,/orderLightSeconds:30/);
});
