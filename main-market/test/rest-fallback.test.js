import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Twelve Data OHLC and Streaming feed the MA5 Bollinger strategy",()=>{
 assert.match(server,/const latestClosedCandle = feed\.candles\.filter/);
 assert.match(server,/price: freshTick \?\? restLastPrice/);
 assert.match(server,/analyzeMa5Bollinger/);
 assert.match(server,/EURUSD_MA5_BOLLINGER_20_2_M1/);
 assert.match(server,/signal:"WAIT"/);
 assert.doesNotMatch(server,/analyzeMarket\(|fetchEma20|fetchAtr14|GEMINI_API_KEY/);
});
test("MA5 Bollinger status reports watch/order schedule and manual-only mode",()=>{
 assert.match(server,/watchSeconds:\[50,54\],orderSeconds:\[55,59\],orderLightSeconds:30/);
 assert.match(server,/manualOnly:true,brokerExecution:false/);
 assert.match(server,/state\.orderUntil = now \+ 30000/);
});
