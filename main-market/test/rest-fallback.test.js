import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarket } from "../src/analyzer.js";
function recentClosedCandles() {
 const minuteStart=Math.floor(Date.now()/60000)*60,start=minuteStart-80*60;
 return Array.from({length:80},(_,i)=>{const close=1.1+i*.00003;return {epoch:start+i*60,time:new Date((start+i*60)*1000).toISOString(),open:close-.00001,high:close+.00003,low:close-.00003,close,live:false};});
}
test("fresh REST-only candles pass the source-quality gate when fallback is enabled",()=>{
 const result=analyzeMarket(recentClosedCandles(),{now:Date.now(),tickAgeSeconds:null,allowRestFallback:true});
 assert.equal(result.dataMode,"REST_FALLBACK");
 assert.equal(result.livePriceReady,true);
 assert.ok(["CALL","PUT","STANDBY"].includes(result.signal));
});
test("REST-only candles remain STANDBY when fallback is not enabled",()=>{
 const result=analyzeMarket(recentClosedCandles(),{now:Date.now(),tickAgeSeconds:null});
 assert.equal(result.signal,"STANDBY");
 assert.equal(result.dataMode,"UNAVAILABLE");
 assert.match(result.reason,/Streaming|fallback/);
});
