import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function candle(epoch, live=true) {
  return {epoch,open:1.1,high:1.101,low:1.099,close:1.1005,live,provisional:live};
}
function run(upTicks,downTicks,nowOffset=12000,totalTicks=upTicks+downTicks+1) {
  const live=candle(1_800_000_060);
  return analyzeEarlyEntryEngine4([live],{
    livePreview:true,now:1_800_000_060_000+nowOffset,
    tickStats:{candleEpoch:live.epoch,upTicks,downTicks,totalTicks}
  });
}

test("Engine 4 returns CALL when upward ticks outnumber downward ticks",()=>{
  const out=run(7,3);
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"TICK_MAJORITY_CALL");
  assert.equal(out.metrics.upTicks,7);
  assert.equal(out.metrics.downTicks,3);
  assert.equal(out.score,70);
});

test("Engine 4 returns PUT when downward ticks outnumber upward ticks",()=>{
  const out=run(2,6);
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"TICK_MAJORITY_PUT");
  assert.equal(out.metrics.downTicks,6);
});

test("Engine 4 waits when upward and downward tick counts are equal",()=>{
  const out=run(4,4);
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_COUNT_TIED");
});

test("Engine 4 waits until at least one directional tick is observed",()=>{
  const out=run(0,0,5000,1);
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_COUNT_TIED");
});

test("Engine 4 ignores ticks from another M1 candle",()=>{
  const live=candle(1_800_000_060);
  const out=analyzeEarlyEntryEngine4([live],{
    livePreview:true,now:1_800_000_065_000,
    tickStats:{candleEpoch:1_800_000_000,upTicks:9,downTicks:0,totalTicks:10}
  });
  assert.equal(out.signal,null);
  assert.equal(out.status,"WAITING_FOR_TICKS");
});

test("Engine 4 closes the entry window at second 25",()=>{
  const out=run(5,1,25000);
  assert.equal(out.signal,null);
  assert.equal(out.status,"ENTRY_WINDOW_CLOSED");
});

test("Engine 4 requires a live M1 preview",()=>{
  const closed=candle(1_800_000_060,false);
  const out=analyzeEarlyEntryEngine4([closed],{
    livePreview:false,now:1_800_000_072_000,
    tickStats:{candleEpoch:closed.epoch,upTicks:5,downTicks:1,totalTicks:7}
  });
  assert.equal(out.ready,false);
  assert.equal(out.status,"NOT_READY");
});
