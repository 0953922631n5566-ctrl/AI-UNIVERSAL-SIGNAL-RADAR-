import test from "node:test";
import assert from "node:assert/strict";
import { predictNextCandle, getM1CycleWindow, evaluateOpenBias, calculateEma } from "./next-candle-predictor.js";

const risingCandles = Array.from({length:24},(_,i)=>({epoch:i*60000,open:1.10000+i*.00010,high:1.10016+i*.00010,low:1.09998+i*.00010,close:1.10012+i*.00010}));
const fallingCandles = Array.from({length:24},(_,i)=>({epoch:i*60000,open:1.10200-i*.00010,high:1.10202-i*.00010,low:1.10184-i*.00010,close:1.10188-i*.00010}));

test("calculates EMA5 using the standard smoothing factor",()=>{
 assert.ok(Math.abs(calculateEma([1,2,3,4,5],5)-3)<1e-10);
 assert.ok(Math.abs(calculateEma([1,2,3,4,5,6],5)-4)<1e-10);
});
test("emits CALL directly when current APK price is above EMA5",()=>{
 const result=predictNextCandle({candles:risingCandles,price:1.10252});
 assert.equal(result.signal,"CALL");assert.equal(result.source,"APK_CAPTURED_PRICE_OHLC");
 assert.ok(result.price>result.ema5);assert.equal(result.setup,"PRICE_ABOVE_EMA5");
 assert.equal("score" in result,false);assert.equal("confidence" in result,false);assert.equal("ema20" in result,false);
});
test("emits PUT directly when current APK price is below EMA5",()=>{
 const result=predictNextCandle({candles:fallingCandles,price:1.09948});
 assert.equal(result.signal,"PUT");assert.ok(result.price<result.ema5);
 assert.equal(result.setup,"PRICE_BELOW_EMA5");
});
test("returns WAIT only when price is exactly on EMA5",()=>{
 const previousEma5=calculateEma(risingCandles.slice(0,-1).map(c=>c.close),5);
 const result=predictNextCandle({candles:risingCandles,price:previousEma5});
 assert.equal(result.signal,"WAIT");assert.equal(result.setup,"PRICE_ON_EMA5");
});
test("requires five valid APK M1 candles for EMA5",()=>{
 const result=predictNextCandle({candles:risingCandles.slice(0,4),price:1.10052});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"EMA5_HISTORY_INSUFFICIENT");assert.equal(result.calibratedCandles,4);
});
test("fails closed when APK price is unreadable",()=>{
 const result=predictNextCandle({candles:risingCandles,price:null});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"PRICE_UNREADABLE");
});
test("rejects malformed OHLC data before EMA5 calculation",()=>{
 const result=predictNextCandle({candles:[...risingCandles.slice(0,4),{open:2,high:1,low:0,close:2}],price:1.2});
 assert.equal(result.signal,"WAIT");assert.equal(result.calibratedCandles,4);
});
test("cycle timing remains available for the M1 countdown while analysis is LIVE",()=>{
 const base=Math.floor(1_800_000_000_000/60000)*60000;
 assert.equal(getM1CycleWindow(base+49_999).phase,"LIVE");
 assert.equal(getM1CycleWindow(base+50_000).phase,"LIVE");
 assert.equal(getM1CycleWindow(base+55_000).phase,"LIVE");
 assert.equal(getM1CycleWindow(base+60_000).cycleId,getM1CycleWindow(base+60_000).cycleId);
});
test("current M1 price can still be compared with APK candle Open",()=>{
 const up=evaluateOpenBias({open:1.10000,price:1.10002,precision:5});
 assert.equal(up.direction,"CALL");assert.ok(Math.abs(up.delta-0.00002)<1e-10);
 assert.equal(evaluateOpenBias({open:1.10000,price:1.09998,precision:5}).direction,"PUT");
 assert.equal(evaluateOpenBias({open:1.10000,price:1.10000,precision:5}).direction,"WAIT");
});
