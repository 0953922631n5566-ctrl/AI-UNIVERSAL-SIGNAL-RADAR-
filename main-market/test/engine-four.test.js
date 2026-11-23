import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_MIN_BODY_PIPS} from "../src/engine-four.js";
import {isEngine4EntryWindow,canDispatchEngine4Signal} from "../src/signal-timing.js";
const source=1_800_000_000;
const target=source+60;
const bullish={epoch:source,open:1.1000,high:1.1008,low:1.0999,close:1.1007,live:false};
const bearish={epoch:source,open:1.1008,high:1.1009,low:1.1000,close:1.1001,live:false};
function analyze(candle=bullish){return analyzeEarlyEntryEngine4([candle],{closedCandle:candle});}
test("detects CALL from one fully closed bullish M1 candle for the immediately following candle",()=>{
 const out=analyze();assert.equal(out.ready,true);assert.equal(out.signal,"CALL");
 assert.equal(out.sourceCandleEpoch,source);assert.equal(out.targetCandleEpoch,target);
 assert.equal(out.strategy,"CLOSED_M1_TO_NEXT_M1_ENTRY");
 assert.equal(out.analysisMode,"CLOSED_M1_BODY_CONFIRMATION");
});
test("detects PUT from one fully closed bearish M1 candle",()=>{
 const out=analyze(bearish);assert.equal(out.ready,true);assert.equal(out.signal,"PUT");
 assert.ok(out.metrics.bodyMovement<0);
});
test("uses only the latest closed candle and does not need three-candle history",()=>{
 const out=analyzeEarlyEntryEngine4([bullish],{});assert.equal(out.ready,true);
 assert.equal(out.metrics.sourceCandleEpoch,source);
});
test("rejects forming candle input and never uses live body movement",()=>{
 const out=analyze({...bullish,live:true});assert.equal(out.ready,false);
 assert.equal(out.status,"CLOSED_M1_CANDLE_NOT_READY");
});
test("rejects weak body or weak close location rather than forcing a signal",()=>{
 const weak={epoch:source,open:1.1,high:1.1008,low:1.0999,close:1.1002,live:false};
 const out=analyze(weak);assert.equal(out.ready,false);assert.equal(out.status,"NO_CLEAR_CLOSED_M1_SIGNAL");
});
test("rejects invalid candle input",()=>{
 const out=analyze({...bullish,close:NaN});assert.equal(out.ready,false);
 assert.equal(out.status,"CLOSED_M1_CANDLE_NOT_READY");
});
test("requires only the next candle's first five seconds and a fresh streaming quote",()=>{
 assert.equal(isEngine4EntryWindow(target,target*1000),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+4999),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+5000),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:null}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:target}),false);
});
test("closed-candle body threshold is explicitly measured in EUR/USD pips",()=>{
 assert.equal(ENGINE4_MIN_BODY_PIPS,0.4);
});
