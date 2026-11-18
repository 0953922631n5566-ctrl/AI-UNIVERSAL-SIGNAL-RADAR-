import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function history(direction="UP") {
 return Array.from({length:40},(_,i)=>{
  const base=1.1+i*.00002,open=base,close=direction==="UP"?base+.00001:base-.00001;
  return {epoch:1_800_000_000+i*60,open,
   high:Math.max(open,close)+.00008,low:Math.min(open,close)-.00008,close,live:false};
 });
}
test("Engine 4 confirms PUT after sweeping a prior high and rejecting it",()=>{
 const h=history("UP"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.high+.00015,low:prev.close-.00002,
  close:prev.close-.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"PUT");
 assert.equal(out.status,"TOP_REVERSAL_CONFIRMED");
 assert.equal(out.targetCandleAt,new Date(epoch*1000).toISOString());
});
test("Engine 4 confirms CALL after sweeping a prior low and rejecting it",()=>{
 const h=history("DOWN"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.close+.00002,low:prev.low-.00015,
  close:prev.low+.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"CALL");
 assert.equal(out.status,"BOTTOM_REVERSAL_CONFIRMED");
});
test("Engine 4 refuses signal at second 30 and later",()=>{
 const h=history("UP"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.high+.00015,low:prev.close-.00002,
  close:prev.high-.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+30000});
 assert.equal(out.signal,null);assert.equal(out.status,"ENTRY_WINDOW_CLOSED");
});
test("Engine 4 requires a live provisional candle",()=>{
 const h=history("UP");
 const out=analyzeEarlyEntryEngine4(h,{livePreview:false,now:h.at(-1).epoch*1000+10000});
 assert.equal(out.ready,false);
});
