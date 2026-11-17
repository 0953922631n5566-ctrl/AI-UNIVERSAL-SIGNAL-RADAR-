import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";
import { canDispatchEngine4Signal, isEngine4EntryWindow } from "../src/signal-timing.js";
function history(direction="UP"){
 return Array.from({length:40},(_,i)=>{
  const base=1.1+i*.000002,open=base,close=direction==="UP"?base+.00002:base-.00002;
  return {epoch:1_800_000_000+i*60,open,high:Math.max(open,close)+.00018,
   low:Math.min(open,close)-.00018,close,live:false};
 });
}
test("Engine 4 confirms bullish pressure during first 30 seconds",()=>{
 const h=history("UP"),epoch=h.at(-1).epoch+60;
 const live={epoch,open:1.1002,high:1.10075,low:1.10018,close:1.10070,live:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"CALL");
 assert.equal(out.targetCandleAt,new Date(epoch*1000).toISOString());
});
test("Engine 4 confirms bearish pressure during first 30 seconds",()=>{
 const h=history("DOWN"),epoch=h.at(-1).epoch+60;
 const live={epoch,open:1.1000,high:1.10002,low:1.09942,close:1.09945,live:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"PUT");
});
test("Engine 4 refuses signal at second 30 and later",()=>{
 const h=history("UP"),epoch=h.at(-1).epoch+60;
 const live={epoch,open:1.1002,high:1.10075,low:1.10018,close:1.10070,live:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+30000});
 assert.equal(out.signal,null);assert.equal(out.status,"ENTRY_WINDOW_CLOSED");
});
test("Engine 4 requires a live provisional candle",()=>{
 const h=history("UP");
 const out=analyzeEarlyEntryEngine4(h,{livePreview:false,now:h.at(-1).epoch*1000+10000});
 assert.equal(out.ready,false);
});
test("Engine 4 timing requires fresh tick and prevents duplicate dispatch",()=>{
 const epoch=1_800_000_000,now=epoch*1000+12000,tickAt=now-1000;
 assert.equal(isEngine4EntryWindow(epoch,now),true);
 assert.equal(isEngine4EntryWindow(epoch,epoch*1000+30000),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt,now}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt,now,lastDispatchedCandle:epoch}),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:now-6000,now}),false);
});
