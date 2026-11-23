import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_MIN_BODY_PIPS,ENGINE4_MIN_SCORE,ENGINE4_EMA_FAST_PERIOD,ENGINE4_EMA_SLOW_PERIOD} from "../src/engine-four.js";
import {isEngine4EntryWindow,canDispatchEngine4Signal} from "../src/signal-timing.js";
const source=1_800_000_000;
const target=source+60;
function makeHistory(direction="CALL") {
  return Array.from({length:20},(_,i)=>{
    const close=direction==="CALL"?1.1000+i*0.00005:1.1010-i*0.00005;
    const open=direction==="CALL"?close-0.00005:close+0.00005;
    return {epoch:source-((19-i)*60),open,high:Math.max(open,close)+0.00001,
      low:Math.min(open,close)-0.00001,close,live:false};
  });
}
const bullishHistory=makeHistory("CALL");
const bearishHistory=makeHistory("PUT");
function analyze(history=bullishHistory) {
  const closed=history.at(-1);
  return analyzeEarlyEntryEngine4(history,{closedCandle:closed});
}
test("detects CALL when EMA 5 is above EMA 20 and the latest closed M1 body confirms",()=>{
 const out=analyze();assert.equal(out.ready,true);assert.equal(out.signal,"CALL");
 assert.equal(out.sourceCandleEpoch,source);assert.equal(out.targetCandleEpoch,target);
 assert.equal(out.strategy,"EMA5_20_CLOSED_M1_TO_NEXT_M1_ENTRY");
 assert.equal(out.metrics.emaDirection,"CALL");assert.ok(out.score>=40);
});
test("detects PUT when EMA 5 is below EMA 20 and the latest closed M1 body confirms",()=>{
 const out=analyze(bearishHistory);assert.equal(out.ready,true);assert.equal(out.signal,"PUT");
 assert.equal(out.metrics.emaDirection,"PUT");assert.ok(out.metrics.ema5<out.metrics.ema20);
});
test("requires 20 completed candles for EMA 5/20 warmup",()=>{
 const out=analyzeEarlyEntryEngine4(bullishHistory.slice(-19),{closedCandle:bullishHistory.at(-1)});
 assert.equal(out.ready,false);assert.equal(out.status,"EMA_HISTORY_NOT_READY");
});
test("rejects a forming candle and never uses its live OHLC",()=>{
 const live={...bullishHistory.at(-1),live:true};
 const out=analyzeEarlyEntryEngine4([...bullishHistory.slice(0,-1),live],{closedCandle:live});
 assert.equal(out.ready,false);assert.equal(out.status,"CLOSED_M1_CANDLE_NOT_READY");
});
test("rejects a closed candle whose body opposes the EMA direction",()=>{
 const history=bullishHistory.slice();
 const prior=history.at(-1);
 history[19]={...prior,open:prior.close+0.00005,close:prior.close,high:prior.close+0.00006,low:prior.close-0.00001};
 const out=analyze(history);assert.equal(out.ready,false);
 assert.equal(out.status,"NO_CLEAR_EMA_CLOSED_M1_SIGNAL");
});
test("rejects candles below the minimum real body size",()=>{
 const history=bullishHistory.slice();const c=history[19];
 history[19]={...c,open:c.close-0.00001,high:c.close+0.00001,low:c.close-0.00002};
 const out=analyze(history);assert.equal(out.ready,false);
 assert.equal(out.status,"NO_CLEAR_EMA_CLOSED_M1_SIGNAL");
});
test("rejects non-adjacent closed candle history",()=>{
 const history=bullishHistory.map(c=>({...c}));
 history[10].epoch+=60;
 const out=analyze(history);assert.equal(out.ready,false);
 assert.equal(out.status,"EMA_HISTORY_NOT_READY");
});
test("score threshold is 40 and includes EMA/body/close/wick evidence",()=>{
 assert.equal(ENGINE4_MIN_SCORE,40);assert.equal(ENGINE4_MIN_BODY_PIPS,0.4);
 assert.equal(ENGINE4_EMA_FAST_PERIOD,5);assert.equal(ENGINE4_EMA_SLOW_PERIOD,20);
 const out=analyze();assert.ok(out.score>=40);
 assert.deepEqual(Object.keys(out.metrics.scoreBreakdown),["emaAlignment","bodyStrength","closeLocation","wickConfirmation"]);
});
test("dispatches only during the first five seconds of the target M1 candle with a fresh Streaming quote",()=>{
 assert.equal(isEngine4EntryWindow(target,target*1000),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+4999),true);
 assert.equal(isEngine4EntryWindow(target,target*1000+5000),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:null}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:target,tickAt:target*1000+100,now:target*1000+200,lastDispatchedCandle:target}),false);
});
