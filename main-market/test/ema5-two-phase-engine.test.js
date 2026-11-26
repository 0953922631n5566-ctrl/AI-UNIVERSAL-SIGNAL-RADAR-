import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEma5Pullback, calculateEma5, enterPreparedSignal, samplingPhase } from "../src/ema5-two-phase-engine.js";

const candles = Array.from({length:30},(_,i)=>({epoch:1000+i*60,open:1+i*0.0001,high:1.001+i*0.0001,low:0.999+i*0.0001,close:1+i*0.0001,live:false}));

test("samples only at the first 3 seconds and last 5 seconds",()=>{
 assert.equal(samplingPhase(120), "OPEN");
 assert.equal(samplingPhase(122), "OPEN");
 assert.equal(samplingPhase(123), "COLLECT");
 assert.equal(samplingPhase(175), "PREPARE");
 assert.equal(samplingPhase(179), "PREPARE");
});
test("EMA5 is calculated from chronological closes",()=>{
 const result=calculateEma5([1,2,3,4,5,6]);
 assert.ok(result.current>result.previous);
});
test("requires fresh streaming data",()=>{
 const result=analyzeEma5Pullback({symbol:"EUR/USD",closedCandles:candles,liveCandle:{...candles.at(-1),epoch:2800,live:true},tickAgeSeconds:6});
 assert.equal(result.signal,"WAIT");
 assert.match(result.reason,/สด/);
});
test("flat EMA slope returns SIDEWAY WAIT",()=>{
 const flat=Array.from({length:30},(_,i)=>({epoch:i*60,open:1,high:1.00001,low:0.99999,close:1,live:false}));
 const result=analyzeEma5Pullback({symbol:"EUR/USD",closedCandles:flat,liveCandle:{epoch:1800,open:1,high:1.00001,low:0.99999,close:1,live:true},tickAgeSeconds:1});
 assert.equal(result.signal,"WAIT");
 assert.equal(result.regime,"SIDEWAY");
});
test("prepared signal enters target candle once only",()=>{
 const state={preparedForEpoch:600,preparedSignal:"CALL",sourceEpoch:540,history:[]};
 const first=enterPreparedSignal(state,600);
 const duplicate=enterPreparedSignal(state,600);
 assert.equal(first.signal,"CALL");
 assert.equal(duplicate,null);
 assert.equal(state.history.length,1);
});

test("upward EMA5 slope plus bullish pullback through EMA5 prepares CALL",()=>{
 const rising=Array.from({length:30},(_,i)=>({epoch:1000+i*60,open:1+i*0.0002,high:1.001+i*0.0002,low:0.999+i*0.0002,close:1+i*0.0002,live:false}));
 const provisional=calculateEma5([...rising.map(c=>c.close),rising.at(-1).close+0.0015]);
 const live={epoch:2800,open:rising.at(-1).close+0.0001,high:rising.at(-1).close+0.001,low:provisional.current-0.00005,close:rising.at(-1).close+0.0007,live:true};
 const result=analyzeEma5Pullback({symbol:"EUR/USD",closedCandles:rising,liveCandle:live,tickAgeSeconds:1});
 assert.equal(result.signal,"CALL");
 assert.equal(result.slope,"UP");
});
test("downward EMA5 slope plus bearish rejection through EMA5 prepares PUT",()=>{
 const falling=Array.from({length:30},(_,i)=>({epoch:1000+i*60,open:1.006-i*0.0002,high:1.007-i*0.0002,low:1.005-i*0.0002,close:1.006-i*0.0002,live:false}));
 const provisional=calculateEma5([...falling.map(c=>c.close),falling.at(-1).close-0.0007]);
 const live={epoch:2800,open:falling.at(-1).close-0.0001,high:provisional.current+0.00005,low:falling.at(-1).close-0.001,close:falling.at(-1).close-0.0007,live:true};
 const result=analyzeEma5Pullback({symbol:"EUR/USD",closedCandles:falling,liveCandle:live,tickAgeSeconds:1});
 assert.equal(result.signal,"PUT");
 assert.equal(result.slope,"DOWN");
});
