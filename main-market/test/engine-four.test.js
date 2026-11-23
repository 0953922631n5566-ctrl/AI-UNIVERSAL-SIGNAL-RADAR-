import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_STRATEGY} from "../src/engine-four.js";
import {isSignalFinalizeWindow,canFinalizeSignal} from "../src/signal-timing.js";
const source=1_800_000_000,target=source+60;
function preview({open=1.1,high=1.1005,low=1.0998,close=1.1002,epoch=source}={}) {
 return {epoch,open,high,low,close,live:false,provisional:true};
}
test("CALL when lower wick is longer than upper wick",()=>{
 const c=preview({high:1.1003,low:1.0995}),o=analyzeEarlyEntryEngine4([c],{liveCandle:c});
 assert.equal(o.ready,true);assert.equal(o.signal,"CALL");assert.equal(o.sourceCandleEpoch,source);
 assert.equal(o.targetCandleEpoch,target);assert.equal(o.strategy,ENGINE4_STRATEGY);
 assert.ok(o.metrics.lowerWick>o.metrics.upperWick);assert.equal("score" in o,false);assert.equal("confidence" in o,false);
});
test("PUT when upper wick is longer than lower wick",()=>{
 const c=preview({high:1.1008,low:1.1001}),o=analyzeEarlyEntryEngine4([c],{liveCandle:c});
 assert.equal(o.ready,true);assert.equal(o.signal,"PUT");assert.ok(o.metrics.upperWick>o.metrics.lowerWick);
});
test("wick comparison is independent of candle body direction",()=>{
 const c=preview({open:1.1003,close:1.1,high:1.1005,low:1.0997});
 assert.equal(analyzeEarlyEntryEngine4([c],{liveCandle:c}).signal,"CALL");
});
test("equal upper and lower wicks produce no signal",()=>{
 const c=preview({high:1.1005,low:1.0997,open:1.1,close:1.1002}),o=analyzeEarlyEntryEngine4([c],{liveCandle:c});
 assert.equal(o.ready,false);assert.equal(o.status,"WICKS_EQUAL");
});
test("does not require historical candles or EMA values",()=>{
 const c=preview(),o=analyzeEarlyEntryEngine4([],{liveCandle:c});
 assert.equal(o.ready,true);assert.equal("ema5" in (o.metrics||{}),false);
});
test("rejects completed candle instead of live provisional preview",()=>{
 const c={...preview(),provisional:false},o=analyzeEarlyEntryEngine4([c],{liveCandle:c});
 assert.equal(o.ready,false);assert.equal(o.status,"LIVE_M1_PREVIEW_NOT_READY");
});
test("rejects malformed live OHLC",()=>{
 const c=preview({high:1.099,low:1.1001});assert.equal(analyzeEarlyEntryEngine4([c],{liveCandle:c}).ready,false);
});
test("uses same T-5 finalization window and fresh-tick guard as Engines 1–3",()=>{
 assert.equal(isSignalFinalizeWindow(source,source*1000+54999),false);
 assert.equal(isSignalFinalizeWindow(source,source*1000+55000),true);
 assert.equal(isSignalFinalizeWindow(source,source*1000+59999),true);
 assert.equal(isSignalFinalizeWindow(source,source*1000+60000),false);
 assert.equal(canFinalizeSignal({candleEpoch:source,tickAt:source*1000+55100,now:source*1000+55200,lastDispatchedCandle:null}),true);
 assert.equal(canFinalizeSignal({candleEpoch:source,tickAt:source*1000+55100,now:source*1000+55200,lastDispatchedCandle:source}),false);
});
