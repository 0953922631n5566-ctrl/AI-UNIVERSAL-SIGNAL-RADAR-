import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";

function candle(epoch, open, high, low, close, live=false) {
  return {epoch,open,high,low,close,live,provisional:live};
}

test("Engine 4 uses only one closed candle and the current live candle for CALL bounce",()=>{
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1002,1.1008,1.0989,1.1007,true);
  const out=analyzeEarlyEntryEngine4([previous,live],{livePreview:true,now:1_800_000_072_000});
  assert.equal(out.signal,"CALL");
  assert.equal(out.metrics.candlesUsed,2);
  assert.equal(out.status,"TWO_CANDLE_SUPPORT_BOUNCE_CALL");
});

test("Engine 4 detects a two-candle false breakout and returns PUT",()=>{
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1002,1.1012,1.1000,1.1001,true);
  const out=analyzeEarlyEntryEngine4([previous,live],{livePreview:true,now:1_800_000_072_000});
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"TWO_CANDLE_FALSE_BREAKUP_PUT");
});

test("Engine 4 detects a two-candle false breakdown and returns CALL",()=>{
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1000,1.1004,1.0988,1.1003,true);
  const out=analyzeEarlyEntryEngine4([previous,live],{livePreview:true,now:1_800_000_072_000});
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"TWO_CANDLE_FALSE_BREAKDOWN_CALL");
});

test("Engine 4 blocks entry from second 30 onward",()=>{
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1002,1.1008,1.0989,1.1007,true);
  const out=analyzeEarlyEntryEngine4([previous,live],{livePreview:true,now:1_800_000_090_000});
  assert.equal(out.signal,null);
  assert.equal(out.status,"ENTRY_WINDOW_CLOSED");
});

test("Engine 4 rejects missing closed candle or missing live candle",()=>{
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1002,1.1008,1.0989,1.1007,true);
  assert.equal(analyzeEarlyEntryEngine4([live],{livePreview:true}).ready,false);
  assert.equal(analyzeEarlyEntryEngine4([previous,live],{livePreview:false}).ready,false);
});

test("Engine 4 ignores all older candles and uses exactly the last two",()=>{
  const older=candle(1_799_999_940,1.1000,1.1050,1.0950,1.1000);
  const previous=candle(1_800_000_000,1.1000,1.1010,1.0990,1.1002);
  const live=candle(1_800_000_060,1.1002,1.1008,1.0989,1.1007,true);
  const out=analyzeEarlyEntryEngine4([older,previous,live],{livePreview:true,now:1_800_000_072_000});
  assert.equal(out.metrics.candlesUsed,2);
});
