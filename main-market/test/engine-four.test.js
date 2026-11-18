import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function history(direction="UP") {
 return Array.from({length:40},(_,i)=>{
  const base=direction==="UP"?1.1+i*.00002:1.1-i*.00002,open=base,close=direction==="UP"?base+.00001:base-.00001;
  return {epoch:1_800_000_000+i*60,open,high:Math.max(open,close)+.00008,
    low:Math.min(open,close)-.00008,close,live:false};
 });
}
test("Engine 4 calls CALL after an uptrend pullback bounces",()=>{
 const h=history("UP"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.close+.00003,low:prev.close-.00015,
   close:prev.close+.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"CALL");
 assert.equal(out.status,"PULLBACK_BOUNCE_CALL");
});
test("Engine 4 calls PUT after a downtrend spike is rejected",()=>{
 const h=history("DOWN"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.close+.00015,low:prev.close-.00003,
   close:prev.close-.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+12000});
 assert.equal(out.signal,"PUT");
 assert.equal(out.status,"SPIKE_REJECTION_PUT");
});
test("Engine 4 refuses signal at second 30 and later",()=>{
 const h=history("UP"),prev=h.at(-1),epoch=prev.epoch+60;
 const live={epoch,open:prev.close,high:prev.close+.00003,low:prev.close-.00015,
   close:prev.close+.00002,live:false,provisional:true};
 const out=analyzeEarlyEntryEngine4([...h,live],{livePreview:true,now:epoch*1000+30000});
 assert.equal(out.signal,null);assert.equal(out.status,"ENTRY_WINDOW_CLOSED");
});
test("Engine 4 requires a live provisional candle",()=>{
 const h=history("UP");
 const out=analyzeEarlyEntryEngine4(h,{livePreview:false,now:h.at(-1).epoch*1000+10000});
 assert.equal(out.ready,false);
});
