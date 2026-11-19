import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_COLLECTION_WINDOW_MS, ENGINE4_DISPATCH_DEADLINE_MS } from "../src/engine-four.js";

function candle(epoch, open=1.1, close=1.1005, live=true, high=Math.max(open,close)+0.0002, low=Math.min(open,close)-0.0002) {
  return {epoch,open,high,low,close,live,provisional:live};
}
function run(upTicks,downTicks,nowOffset=23_000,open=1.1,close=1.1005,extra={}) {
  const live=candle(1_800_000_060,open,close);
  return analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_060_000+nowOffset,
    symbol:"EUR/USD",tickStats:{candleEpoch:live.epoch,upTicks,downTicks,totalTicks:upTicks+downTicks+1},...extra});
}

test("Engine 4 waits for the full first 23 seconds before deciding",()=>{
  const out=run(8,0,22_999);
  assert.equal(out.signal,null);
  assert.equal(out.status,"COLLECTING_FIRST_23_SECONDS");
});
test("Engine 4 emits CALL at the 23-second decision point when evidence is bullish",()=>{
  const out=run(8,1,23_000,1.1,1.1005);
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"M1_23S_FORCED_CALL");
  assert.equal(out.entryPrice,1.1005);
  assert.equal(out.alertId,"ENGINE_4:1800000060:CALL:COLLECT_23_SECONDS");
});
test("Engine 4 emits PUT at the 23-second decision point when evidence is bearish",()=>{
  const out=run(1,8,23_000,1.1,1.0995);
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"M1_23S_FORCED_PUT");
});
test("Engine 4 emits a forced direction when tick pressure is tied but price moved",()=>{
  const out=run(4,4,23_000,1.1,1.1002);
  assert.equal(out.signal,"CALL");
});
test("Engine 4 does not invent a direction when current-candle price and ticks are flat",()=>{
  const live=candle(1_800_000_060,1.1,1.1,true,1.1,1.1);
  const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_083_000,
    symbol:"EUR/USD",
    tickStats:{candleEpoch:live.epoch,upTicks:3,downTicks:3,totalTicks:7}});
  assert.equal(out.signal,null);
  assert.equal(out.status,"NO_DIRECTIONAL_EDGE");
  assert.equal(out.decisionStrength,"NONE");
});
test("Engine 4 uses JPY pip sizing",()=>{
  const out=analyzeEarlyEntryEngine4([candle(1_800_000_060,150.0,150.02,true,150.03,149.99)],{
    livePreview:true,now:1_800_000_083_000,symbol:"GBP/JPY",
    tickStats:{candleEpoch:1_800_000_060,upTicks:5,downTicks:1,totalTicks:7}});
  assert.equal(out.metrics.pipSize,0.01);
  assert.equal(out.metrics.priceMovePips,2);
});
test("Engine 4 refuses to decide after the 30-second order cutoff",()=>{
  const out=run(8,0,30_000);
  assert.equal(out.signal,null);
  assert.equal(out.status,"ENTRY_DEADLINE_MISSED");
});
test("Engine 4 requires a fresh forming M1 candle",()=>{
  const closed=candle(1_800_000_060,1.1,1.1005,false);
  const out=analyzeEarlyEntryEngine4([closed],{livePreview:false,now:1_800_000_083_000,
    tickStats:{candleEpoch:closed.epoch,upTicks:5,downTicks:1,totalTicks:7}});
  assert.equal(out.ready,false);
  assert.equal(out.status,"NOT_READY");
});
test("Engine 4 refuses to fabricate a direction when this candle tick stats are missing",()=>{
  const live=candle(1_800_000_060);
  const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_083_000,
    tickStats:{candleEpoch:1_800_000_000,upTicks:9,downTicks:0,totalTicks:10}});
  assert.equal(out.signal,null);
  assert.equal(out.status,"TICK_STATS_UNAVAILABLE");
});
test("collection and dispatch windows are fixed to 23 seconds and the 30-second cutoff",()=>{
  assert.equal(ENGINE4_COLLECTION_WINDOW_MS,23_000);
  assert.equal(ENGINE4_DISPATCH_DEADLINE_MS,30_000);
});
