import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_EMA_PERIOD,ENGINE4_MIN_CANDLES} from "../src/engine-four.js";
import {isEngine4EntryWindow,canDispatchEngine4Signal} from "../src/signal-timing.js";
const source=1_800_000_000;
const target=source+60;
function makeHistory(direction="CALL",count=12) {
  return Array.from({length:count},(_,i)=>{
    const close=direction==="CALL"?1.1000+i*0.00005:1.1010-i*0.00005;
    const open=direction==="CALL"?close-0.00005:close+0.00005;
    return {epoch:source-((count-1-i)*60),open,high:Math.max(open,close)+0.00001,
      low:Math.min(open,close)-0.00001,close,live:false};
  });
}
test("CALL when the latest closed M1 close is above EMA 5",()=>{
  const candles=makeHistory("CALL"),out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(out.ready,true);assert.equal(out.signal,"CALL");assert.equal(out.sourceCandleEpoch,source);
  assert.equal(out.targetCandleEpoch,target);assert.equal(out.strategy,"EMA5_CLOSED_M1_TO_NEXT_M1_ENTRY");
  assert.ok(out.metrics.closedClose>out.metrics.ema5);assert.equal("score" in out,false);
  assert.equal("confidence" in out,false);
});
test("PUT when the latest closed M1 close is below EMA 5",()=>{
  const candles=makeHistory("PUT"),out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(out.ready,true);assert.equal(out.signal,"PUT");assert.ok(out.metrics.closedClose<out.metrics.ema5);
});
test("uses Close versus EMA 5 only; candle body direction is irrelevant",()=>{
  const candles=makeHistory("CALL"),last=candles.at(-1);
  candles[candles.length-1]={...last,open:last.close+0.00003,high:last.close+0.00004,low:last.close-0.00001};
  const out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(out.ready,true);assert.equal(out.signal,"CALL");
});
test("returns no signal when the latest close equals EMA 5",()=>{
  const candles=Array.from({length:8},(_,i)=>({epoch:source-((7-i)*60),open:1.1,high:1.1001,low:1.0999,close:1.1,live:false}));
  const out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(out.ready,false);assert.equal(out.status,"CLOSE_EQUALS_EMA5");
});
test("requires only five completed M1 candles for EMA 5",()=>{
  const candles=makeHistory("CALL",ENGINE4_MIN_CANDLES),out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(ENGINE4_EMA_PERIOD,5);assert.equal(out.ready,true);
});
test("does not use a forming candle for direction",()=>{
  const candles=makeHistory("CALL"),live={...candles.at(-1),live:true};
  const out=analyzeEarlyEntryEngine4([...candles.slice(0,-1),live],{closedCandle:live});
  assert.equal(out.ready,false);assert.equal(out.status,"CLOSED_M1_CANDLE_NOT_READY");
});
test("rejects a gap in recent closed M1 history",()=>{
  const candles=makeHistory("CALL");candles[candles.length-2].epoch-=60;
  const out=analyzeEarlyEntryEngine4(candles,{closedCandle:candles.at(-1)});
  assert.equal(out.ready,false);assert.equal(out.status,"EMA_HISTORY_NOT_READY");
});
test("dispatch remains limited to first five seconds of next M1 with fresh Streaming quote",()=>{
  assert.equal(isEngine4EntryWindow(target,target*1000),true);
  assert.equal(isEngine4EntryWindow(target,target*1000+4999),true);
  assert.equal(isEngine4EntryWindow(target,target*1000+5000),false);
  assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:null}),true);
  assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:target}),false);
});
