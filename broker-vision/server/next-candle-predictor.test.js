import test from "node:test";
import assert from "node:assert/strict";
import { predictNextCandle, getM1CycleWindow, evaluateOpenBias, calculateEma } from "./next-candle-predictor.js";

const risingCandles = Array.from({length:24},(_,i)=>({epoch:i*60000,open:1.10000+i*.00010,high:1.10016+i*.00010,low:1.09998+i*.00010,close:1.10012+i*.00010}));
const fallingCandles = Array.from({length:24},(_,i)=>({epoch:i*60000,open:1.10200-i*.00010,high:1.10202-i*.00010,low:1.10184-i*.00010,close:1.10188-i*.00010}));

test("calculates an EMA using the standard smoothing factor",()=>{
 assert.ok(Math.abs(calculateEma([1,2,3,4,5],3)-4.0)<1e-10);
});
test("predicts CALL when APK prices show EMA5 above EMA20",()=>{
 const result=predictNextCandle({candles:risingCandles,price:1.10252,priceHistory:[1.10240,1.10245,1.10252]});
 assert.equal(result.signal,"CALL");assert.equal(result.source,"APK_CAPTURED_PRICE_OHLC");
 assert.ok(result.ema5>result.ema20);
});
test("predicts PUT when APK prices show EMA5 below EMA20",()=>{
 const result=predictNextCandle({candles:fallingCandles,price:1.09948,priceHistory:[1.09960,1.09955,1.09948]});
 assert.equal(result.signal,"PUT");assert.ok(result.ema5<result.ema20);
});
test("waits until at least 20 valid APK candles exist for EMA20",()=>{
 const result=predictNextCandle({candles:risingCandles.slice(0,19),price:1.102});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"EMA_HISTORY_INSUFFICIENT");
});
test("fails closed when APK price is unreadable",()=>{
 const result=predictNextCandle({candles:risingCandles,price:null});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"PRICE_UNREADABLE");
});
test("rejects malformed OHLC data before EMA calculation",()=>{
 const result=predictNextCandle({candles:[...risingCandles.slice(0,19),{open:2,high:1,low:0,close:2}],price:1.2});
 assert.equal(result.calibratedCandles,19);
});
test("M1 cycle reports WATCH only during seconds 50-54 and ORDER during 55-59",()=>{
 const base=Math.floor(1_800_000_000_000/60000)*60000;
 assert.equal(getM1CycleWindow(base+49_999).phase,"WAITING");
 assert.equal(getM1CycleWindow(base+50_000).phase,"WATCH");
 assert.equal(getM1CycleWindow(base+54_999).phase,"WATCH");
 assert.equal(getM1CycleWindow(base+55_000).phase,"ORDER");
 assert.equal(getM1CycleWindow(base+59_999).phase,"ORDER");
 assert.equal(getM1CycleWindow(base+60_000).phase,"WAITING");
 assert.notEqual(getM1CycleWindow(base).cycleId,getM1CycleWindow(base+60_000).cycleId);
});
test("current M1 price can still be compared with APK candle Open",()=>{
 const up=evaluateOpenBias({open:1.10000,price:1.10002,precision:5});
 assert.equal(up.direction,"CALL");assert.ok(Math.abs(up.delta-0.00002)<1e-10);
 assert.equal(evaluateOpenBias({open:1.10000,price:1.09998,precision:5}).direction,"PUT");
 assert.equal(evaluateOpenBias({open:1.10000,price:1.10000,precision:5}).direction,"WAIT");
});
