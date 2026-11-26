import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Twelve Data OHLC and Streaming feed the EMA5 two-phase strategy",()=>{
 assert.match(server,/const latestClosedCandle = feed\.candles\.filter/);
 assert.match(server,/price: freshTick \?\? restLastPrice/);
 assert.match(server,/analyzeEma5Pullback/);
 assert.match(server,/EMA5_PULLBACK_TWO_PHASE_M1/);
 assert.match(server,/signal: "WAIT"/);
 assert.doesNotMatch(server,/analyzeMarket\(|fetchEma20|fetchAtr14|GEMINI_API_KEY/);
});
test("EMA5 status projection reports sampling schedule and manual-only entry",()=>{
 assert.match(server,/sampling:\{openSeconds:\[0,2\],prepareSeconds:\[55,59\],entrySeconds:\[0,5\],restCallsPerMinute:2\}/);
 assert.match(server,/manualOnly:true,brokerExecution:false/);
 assert.match(server,/enterPreparedSignal\(state,minute\)/);
});
