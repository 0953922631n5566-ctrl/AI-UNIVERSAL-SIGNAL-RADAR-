import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function risingHistory() {
  return Array.from({length:35},(_,i)=>({
    epoch:Math.floor(1_800_000_000/60)*60-((34-i)*60),
    open:100+i,high:100.7+i,low:99.8+i,close:100.5+i
  }));
}
function fallingHistory() {
  return Array.from({length:35},(_,i)=>({
    epoch:Math.floor(1_800_000_000/60)*60-((34-i)*60),
    open:140-i,high:140.2-i,low:139.3-i,close:139.5-i
  }));
}
test("Engine 4 calls PUT after sweeping a prior high and rejecting it",()=>{
  const history=risingHistory(), prev=history.at(-1), epoch=1_800_000_000;
  const live={epoch,live:true,open:prev.close,high:prev.high+0.5,low:prev.close-0.1,close:prev.close-0.12};
  const result=analyzeEarlyEntryEngine4([...history,live],{livePreview:true,now:epoch*1000+12000});
  assert.equal(result.signal,"PUT");
  assert.equal(result.status,"TOP_REVERSAL_CONFIRMED");
});
test("Engine 4 calls CALL after sweeping a prior low and rejecting it",()=>{
  const history=fallingHistory(),prev=history.at(-1),epoch=1_800_000_000;
  const live={epoch,live:true,open:prev.close,high:prev.close+0.1,low:prev.low-0.5,close:prev.close+0.12};
  const result=analyzeEarlyEntryEngine4([...history,live],{livePreview:true,now:epoch*1000+12000});
  assert.equal(result.signal,"CALL");
  assert.equal(result.status,"BOTTOM_REVERSAL_CONFIRMED");
});
test("Engine 4 does not issue a signal after the first 30 seconds",()=>{
  const history=risingHistory(),prev=history.at(-1),epoch=1_800_000_000;
  const live={epoch,live:true,open:prev.close,high:prev.high+0.5,low:prev.close-0.1,close:prev.close-0.12};
  const result=analyzeEarlyEntryEngine4([...history,live],{livePreview:true,now:epoch*1000+30000});
  assert.equal(result.signal,null);
  assert.equal(result.status,"ENTRY_WINDOW_CLOSED");
});
