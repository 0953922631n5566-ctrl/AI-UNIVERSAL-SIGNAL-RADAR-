import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_DECISION_WINDOW_MS,ENGINE4_LOOKBACK_CANDLES} from "../src/engine-four.js";
import {isEngine4EntryWindow,canDispatchEngine4Signal} from "../src/signal-timing.js";
const target=1_800_000_060;
const rising=[
 {epoch:target-180,open:1.1000,close:1.1002,high:1.1003,low:1.0999,live:false},
 {epoch:target-120,open:1.1002,close:1.1004,high:1.1005,low:1.1001,live:false},
 {epoch:target-60,open:1.1004,close:1.1006,high:1.1007,low:1.1003,live:false}
];
const falling=[
 {epoch:target-180,open:1.1010,close:1.1008,high:1.1011,low:1.1007,live:false},
 {epoch:target-120,open:1.1008,close:1.1006,high:1.1009,low:1.1005,live:false},
 {epoch:target-60,open:1.1006,close:1.1004,high:1.1007,low:1.1003,live:false}
];
function analyze(candles=rising,elapsed=100,currentPrice=1.10061){
 return analyzeEarlyEntryEngine4(candles,{now:target*1000+elapsed,targetCandleEpoch:target,currentPrice});
}
test("uses only three completed candles and targets the next M1 candle",()=>{
 const out=analyze();assert.equal(out.signal,"CALL");assert.equal(out.decisionMade,true);
 assert.equal(out.targetCandleEpoch,target);assert.equal(out.metrics.closedCandlesUsed.length,3);
 assert.equal(out.analysisMode,"CLOSED_M1_NEXT_CANDLE");assert.equal(out.entryPriceBasis,"FIRST_STREAM_TICK_OF_TARGET_M1");
});
test("predicts PUT when the three closed candle bodies are net bearish",()=>{
 const out=analyze(falling);assert.equal(out.signal,"PUT");assert.ok(out.metrics.downwardBodyMovement>out.metrics.upwardBodyMovement);
});
test("does not use live or provisional candles",()=>{
 const live={epoch:target,open:1.1006,high:1.1007,low:1.1005,close:1.10065,live:true};
 const out=analyze([...rising,live]);assert.equal(out.signal,"CALL");
 assert.equal(out.metrics.closedCandlesUsed.includes(target),false);
});
test("ties produce no directional forecast",()=>{
 const balanced=[
 {epoch:target-180,open:1.1,close:1.1002,high:1.1003,low:1.0999},
 {epoch:target-120,open:1.1002,close:1.1,high:1.1003,low:1.0999},
 {epoch:target-60,open:1.1,close:1.1,high:1.1003,low:1.0999}
 ];
 const out=analyze(balanced);assert.equal(out.signal,null);assert.equal(out.decisionMade,true);
 assert.equal(out.status,"CLOSED_CANDLE_PRESSURE_TIE");
});
test("requires three consecutive valid closed candles",()=>{
 const out=analyze(rising.slice(1));assert.equal(out.ready,false);
 assert.equal(out.status,"INSUFFICIENT_CLOSED_CANDLES");
});
test("rejects a forecast after the opening decision window",()=>{
 const out=analyze(rising,ENGINE4_DECISION_WINDOW_MS);assert.equal(out.ready,false);
 assert.equal(out.status,"DECISION_WINDOW_CLOSED");
});
test("rejects candles that are not aligned with target candle open",()=>{
 const bad=rising.map((c,i)=>({...c,epoch:c.epoch+(i===2?60:0)}));
 const out=analyze(bad);assert.equal(out.ready,false);assert.equal(out.status,"CLOSED_CANDLE_NOT_ALIGNED");
});
test("Engine 4 dispatch window is the first five seconds of the target candle",()=>{
 assert.equal(ENGINE4_LOOKBACK_CANDLES,3);assert.equal(isEngine4EntryWindow(target,target*1000),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+4999),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+5000),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:null}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:target}),false);
});
