import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function candle(epoch, open=1.1, close=1.1005, live=true) {
  return {epoch,open,high:Math.max(open,close)+0.0002,low:Math.min(open,close)-0.0002,close,live,provisional:live};
}
function run(upTicks,downTicks,nowOffset=3000,open=1.1,close=1.1005) {
  const live=candle(1_800_000_060,open,close);
  return analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_060_000+nowOffset,
    tickStats:{candleEpoch:live.epoch,upTicks,downTicks,totalTicks:upTicks+downTicks+1}});
}

test("Engine 4 can signal CALL immediately from the current candle when price and ticks agree",()=>{
  const out=run(3,0,3000,1.1,1.1002);
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"LIVE_PRICE_AND_TICKS_CALL");
  assert.equal(out.entryPrice,1.1002);
  assert.equal(out.metrics.directionalConfidencePct,100);
});
test("Engine 4 can signal PUT immediately from the current candle when price and ticks agree",()=>{
  const out=run(0,3,5000,1.1,1.0998);
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"LIVE_PRICE_AND_TICKS_PUT");
  assert.equal(out.entryPrice,1.0998);
});
test("Engine 4 uses only the latest forming candle and does not need historical candles",()=>{
  const live=candle(1_800_000_060,1.1,1.1002);
  const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_063_000,
    tickStats:{candleEpoch:live.epoch,upTicks:3,downTicks:0,totalTicks:4}});
  assert.equal(out.signal,"CALL");
});
test("Engine 4 waits only for enough directional ticks, not for a fixed candle second",()=>{
  const out=run(2,0,2000,1.1,1.1002);
  assert.equal(out.signal,null);
  assert.equal(out.status,"COLLECTING_LIVE_TICKS");
});
test("Engine 4 refuses signal when price movement is under 0.1 pip",()=>{
  const out=run(3,0,3000,1.1,1.100005);
  assert.equal(out.signal,null);
  assert.equal(out.status,"PRICE_MOVE_TOO_SMALL");
});
test("Engine 4 refuses signal when price direction conflicts with tick majority",()=>{
  const out=run(0,3,3000,1.1,1.1002);
  assert.equal(out.signal,null);
  assert.equal(out.status,"PRICE_TICK_CONFLICT");
});
test("Engine 4 accepts a 60 percent tick majority",()=>{
  const out=run(3,2,3000,1.1,1.1002);
  assert.equal(out.signal,"CALL");
  assert.equal(out.score,60);
});
test("Engine 4 refuses a weak tick majority below 60 percent",()=>{
  const out=run(4,3,3000,1.1,1.1002);
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_MAJORITY_TOO_WEAK");
});
test("Engine 4 refuses a tied tick count",()=>{
  const out=run(3,3,3000,1.1,1.1002);
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_COUNT_TIED");
});
test("Engine 4 ignores tick stats from another M1 candle",()=>{
  const live=candle(1_800_000_060);
  const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_063_000,
    tickStats:{candleEpoch:1_800_000_000,upTicks:9,downTicks:0,totalTicks:10}});
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_STATS_UNAVAILABLE");
});
test("Engine 4 closes its live decision window at the end of the current M1 candle",()=>{
  const out=run(5,1,60000);
  assert.equal(out.signal,null);
  assert.equal(out.status,"CANDLE_WINDOW_CLOSED");
});
test("Engine 4 requires a live M1 preview",()=>{
  const closed=candle(1_800_000_060,1.1,1.1005,false);
  const out=analyzeEarlyEntryEngine4([closed],{livePreview:false,now:1_800_000_063_000,
    tickStats:{candleEpoch:closed.epoch,upTicks:5,downTicks:1,totalTicks:7}});
  assert.equal(out.ready,false);
  assert.equal(out.status,"NOT_READY");
});
test("Engine 4 refreshes its price analysis as the current candle moves",()=>{
  const live=candle(1_800_000_060,1.1,1.1002);
  const first=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_063_000,
    tickStats:{candleEpoch:live.epoch,upTicks:3,downTicks:0,totalTicks:4}});
  const moved={...live,close:1.1003};
  const second=analyzeEarlyEntryEngine4([moved],{livePreview:true,now:1_800_000_065_000,
    tickStats:{candleEpoch:live.epoch,upTicks:4,downTicks:0,totalTicks:5}});
  assert.equal(first.entryPrice,1.1002);
  assert.equal(second.entryPrice,1.1003);
});
