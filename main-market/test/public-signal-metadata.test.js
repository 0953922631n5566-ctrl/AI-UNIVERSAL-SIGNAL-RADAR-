import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("public signal metadata identifies indicator-free custom candle lines for EUR/USD",()=>{
 assert.match(server,/analysisMode: "EURUSD_CUSTOM_CANDLE_LINES_M1"/);
 assert.match(server,/indicatorSource: "NONE · Twelve Data real M1 OHLC \+ custom candle geometry lines"/);
 assert.match(server,/signalReleaseStatus: "EURUSD_CUSTOM_CANDLE_LINES_M1_MANUAL_ONLY_NOT_OOS_VALIDATED"/);
 assert.match(server,/CUSTOM_PER_CANDLE_GEOMETRY_LINES_THRESHOLD_80/);
});
test("public signal advertises the 10-second watch, final-5-second order and 30-second lamp",()=>{
 assert.match(server,/watchSeconds:\[50,54\]/);
 assert.match(server,/orderSeconds:\[55,59\]/);
 assert.match(server,/orderLightSeconds:30/);
});
