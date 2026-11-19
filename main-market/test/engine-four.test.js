import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";
function candle(epoch, open=1.1, close=1.1005, live=true) { return {epoch,open,high:Math.max(open,close)+0.0002,low:Math.min(open,close)-0.0002,close,live,provisional:live}; }
function run(upTicks,downTicks,nowOffset=25000,open=1.1,close=1.1005) {
 const live=candle(1_800_000_060,open,close);
 return analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_060_000+nowOffset,
 tickStats:{candleEpoch:live.epoch,upTicks,downTicks,totalTicks:upTicks+downTicks+1,decisionPrice:close,decisionElapsedSeconds:25}});
}
test("Engine 4 collects without signaling before second 25",()=>{const out=run(7,3,24999);assert.equal(out.signal,null);assert.equal(out.status,"COLLECTING_FIRST_25_SECONDS");});
test("Engine 4 decides CALL only when price displacement and tick majority both rise",()=>{const out=run(7,3);assert.equal(out.signal,"CALL");assert.equal(out.status,"PRICE_AND_TICKS_CALL");assert.equal(out.metrics.upTicks,7);assert.equal(out.metrics.downTicks,3);assert.equal(out.metrics.priceMovePips,5);assert.equal(out.entryPrice,1.1005);});
test("Engine 4 uses the frozen second-25 decision price even if the live candle later moves",()=>{
 const live=candle(1_800_000_060,1.1,1.101);
 const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_098_000,
  tickStats:{candleEpoch:live.epoch,upTicks:7,downTicks:3,totalTicks:11,decisionPrice:1.1005,decisionElapsedSeconds:25}});
 assert.equal(out.signal,"CALL");
 assert.equal(out.entryPrice,1.1005);
 assert.equal(out.metrics.currentPrice,1.1005);
 assert.equal(out.metrics.decisionElapsedSeconds,25);
});
test("Engine 4 waits for a live tick snapshot at or after second 25",()=>{
 const live=candle(1_800_000_060);
 const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_085_000,
  tickStats:{candleEpoch:live.epoch,upTicks:7,downTicks:3,totalTicks:11,decisionPrice:null}});
 assert.equal(out.signal,null);
 assert.equal(out.status,"WAITING_FOR_DECISION_PRICE");
});
test("Engine 4 decides PUT only when price displacement and tick majority both fall",()=>{const out=run(2,6,25000,1.1,1.0995);assert.equal(out.signal,"PUT");assert.equal(out.status,"PRICE_AND_TICKS_PUT");assert.equal(out.metrics.downTicks,6);assert.equal(out.metrics.priceMovePips,-5);});
test("Engine 4 refuses signal when price rises but downward ticks dominate",()=>{const out=run(2,6);assert.equal(out.signal,null);assert.equal(out.status,"PRICE_TICK_CONFLICT");});
test("Engine 4 refuses signal when price falls but upward ticks dominate",()=>{const out=run(7,3,25000,1.1,1.0995);assert.equal(out.signal,null);assert.equal(out.status,"PRICE_TICK_CONFLICT");});
test("Engine 4 refuses signal when tick counts tie",()=>{const out=run(4,4);assert.equal(out.signal,null);assert.equal(out.status,"TICK_COUNT_TIED");});
test("Engine 4 refuses signal when price movement is under 0.1 pip",()=>{const out=run(7,3,25000,1.1,1.100005);assert.equal(out.signal,null);assert.equal(out.status,"PRICE_MOVE_TOO_SMALL");});
test("Engine 4 ignores tick stats from another M1 candle",()=>{const live=candle(1_800_000_060);const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_085_000,tickStats:{candleEpoch:1_800_000_000,upTicks:9,downTicks:0,totalTicks:10}});assert.equal(out.signal,null);assert.equal(out.status,"TICK_COUNT_TIED");});
test("Engine 4 closes its decision window at the end of the M1 candle",()=>{const out=run(5,1,60000);assert.equal(out.signal,null);assert.equal(out.status,"DECISION_WINDOW_CLOSED");});
test("Engine 4 requires a live M1 preview",()=>{const closed=candle(1_800_000_060,1.1,1.1005,false);const out=analyzeEarlyEntryEngine4([closed],{livePreview:false,now:1_800_000_085_000,tickStats:{candleEpoch:closed.epoch,upTicks:5,downTicks:1,totalTicks:7}});assert.equal(out.ready,false);assert.equal(out.status,"NOT_READY");});
