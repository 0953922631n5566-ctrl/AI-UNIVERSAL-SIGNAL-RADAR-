import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4 } from "../src/engine-four.js";
function candle(epoch, live=true) { return {epoch,open:1.1,high:1.101,low:1.099,close:1.1005,live,provisional:live}; }
function run(upTicks,downTicks,nowOffset=25000,totalTicks=upTicks+downTicks+1) {
 const live=candle(1_800_000_060);
 return analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_060_000+nowOffset,
 tickStats:{candleEpoch:live.epoch,upTicks,downTicks,totalTicks}});
}
test("Engine 4 collects without signaling before second 25",()=>{const out=run(7,3,24999);assert.equal(out.signal,null);assert.equal(out.status,"COLLECTING_FIRST_25_SECONDS");});
test("Engine 4 decides CALL at second 25 when upward ticks outnumber downward ticks",()=>{const out=run(7,3);assert.equal(out.signal,"CALL");assert.equal(out.status,"TICK_MAJORITY_CALL");assert.equal(out.metrics.upTicks,7);assert.equal(out.metrics.downTicks,3);assert.equal(out.score,70);});
test("Engine 4 decides PUT at second 25 when downward ticks outnumber upward ticks",()=>{const out=run(2,6);assert.equal(out.signal,"PUT");assert.equal(out.status,"TICK_MAJORITY_PUT");assert.equal(out.metrics.downTicks,6);});
test("Engine 4 does not signal when upward and downward tick counts are equal",()=>{const out=run(4,4);assert.equal(out.signal,null);assert.equal(out.status,"TICK_COUNT_TIED");});
test("Engine 4 does not signal when no directional tick is observed",()=>{const out=run(0,0,25000,1);assert.equal(out.signal,null);assert.equal(out.status,"TICK_COUNT_TIED");});
test("Engine 4 ignores tick stats from another M1 candle",()=>{const live=candle(1_800_000_060);const out=analyzeEarlyEntryEngine4([live],{livePreview:true,now:1_800_000_085_000,tickStats:{candleEpoch:1_800_000_000,upTicks:9,downTicks:0,totalTicks:10}});assert.equal(out.signal,null);assert.equal(out.status,"TICK_COUNT_TIED");});
test("Engine 4 closes its decision window at the end of the M1 candle",()=>{const out=run(5,1,60000);assert.equal(out.signal,null);assert.equal(out.status,"DECISION_WINDOW_CLOSED");});
test("Engine 4 requires a live M1 preview",()=>{const closed=candle(1_800_000_060,false);const out=analyzeEarlyEntryEngine4([closed],{livePreview:false,now:1_800_000_085_000,tickStats:{candleEpoch:closed.epoch,upTicks:5,downTicks:1,totalTicks:7}});assert.equal(out.ready,false);assert.equal(out.status,"NOT_READY");});
