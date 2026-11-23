import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_MIN_ELAPSED_MS} from "../src/engine-four.js";
import {isEngine4EntryWindow,canDispatchEngine4Signal} from "../src/signal-timing.js";
const source=1_800_000_000;
const target=source+60;
const bullish={epoch:source,open:1.1000,high:1.1008,low:1.0999,close:1.1007,live:true};
const bearish={epoch:source,open:1.1008,high:1.1009,low:1.1000,close:1.1001,live:true};
function analyze(candle=bullish,elapsed=12_000){
 return analyzeEarlyEntryEngine4([candle],{now:source*1000+elapsed,liveCandle:candle,currentPrice:candle.close});
}
test("detects strong live bullish momentum without waiting for three closed candles",()=>{
 const out=analyze();assert.equal(out.ready,true);assert.equal(out.signal,"CALL");
 assert.equal(out.sourceCandleEpoch,source);assert.equal(out.targetCandleEpoch,target);
 assert.equal(out.analysisMode,"LIVE_M1_BODY_MOMENTUM");
});
test("detects strong live bearish momentum for the next M1 candle",()=>{
 const out=analyze(bearish);assert.equal(out.ready,true);assert.equal(out.signal,"PUT");
 assert.ok(out.metrics.bodyMovement<0);
});
test("does not require or inspect historical closed candles",()=>{
 const out=analyze([bullish]);assert.equal(out.ready,true);assert.equal(out.metrics.sourceCandleEpoch,source);
});
test("waits briefly for live momentum to form at the start of the source candle",()=>{
 const out=analyze(bullish,ENGINE4_MIN_ELAPSED_MS-1);assert.equal(out.ready,false);
 assert.equal(out.status,"COLLECTING_LIVE_MOMENTUM");
});
test("rejects weak body or weak close location rather than forcing a signal",()=>{
 const weak={epoch:source,open:1.1,high:1.1008,low:1.0999,close:1.1002,live:true};
 const out=analyze(weak);assert.equal(out.ready,false);assert.equal(out.status,"NO_CLEAR_LIVE_MOMENTUM");
});
test("rejects invalid or non-live candle input",()=>{
 const out=analyze({...bullish,live:false});assert.equal(out.ready,false);
 assert.equal(out.status,"LIVE_M1_CANDLE_NOT_READY");
});
test("dispatches only during the first five seconds of the target M1 candle",()=>{
 assert.equal(isEngine4EntryWindow(target,target*1000),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+4999),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+5000),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:null}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:target}),false);
});
