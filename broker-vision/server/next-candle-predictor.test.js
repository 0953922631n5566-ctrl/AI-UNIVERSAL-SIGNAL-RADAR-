import test from "node:test";
import assert from "node:assert/strict";
import { predictNextCandle } from "./next-candle-predictor.js";

const up = i => ({epoch:i*60000,open:1.1000+i*.0001,high:1.10015+i*.0001,low:1.09998+i*.0001,close:1.10012+i*.0001,samples:20});
const down = i => ({epoch:i*60000,open:1.1010-i*.0001,high:1.10102-i*.0001,low:1.10085-i*.0001,close:1.10088-i*.0001,samples:20});

test("predicts CALL from rising APK-derived M1 OHLC candles",()=>{
 const candles=Array.from({length:6},(_,i)=>up(i));
 const result=predictNextCandle({candles,price:1.10062,priceHistory:[1.1005,1.10055,1.10062]});
 assert.equal(result.signal,"CALL");assert.equal(result.target,"NEXT_M1_CANDLE");
 assert.equal(result.source,"APK_CAPTURED_PRICE_OHLC");assert.equal(result.calibration,"APK_PRICE_DERIVED_M1_OHLC");
});
test("predicts PUT from falling APK-derived M1 OHLC candles",()=>{
 const candles=Array.from({length:6},(_,i)=>down(i));
 const result=predictNextCandle({candles,price:1.10038,priceHistory:[1.1005,1.10045,1.10038]});
 assert.equal(result.signal,"PUT");assert.equal(result.target,"NEXT_M1_CANDLE");
});
test("waits when latest APK price conflicts with bullish candle structure",()=>{
 const result=predictNextCandle({candles:Array.from({length:6},(_,i)=>up(i)),price:1.10062,priceHistory:[1.1007,1.1006,1.1005]});
 assert.equal(result.signal,"WAIT");assert.match(result.reason,/ขัด/);
});
test("fails closed until four complete M1 OHLC candles are available",()=>{
 const result=predictNextCandle({candles:[up(0),up(1),up(2)],price:1.1003});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"CANDLE_DATA_INSUFFICIENT");
});
test("fails closed when APK price is unreadable",()=>{
 const result=predictNextCandle({candles:Array.from({length:6},(_,i)=>up(i)),price:null});
 assert.equal(result.signal,"WAIT");assert.equal(result.status,"PRICE_UNREADABLE");
});
test("rejects malformed OHLC data",()=>{
 const result=predictNextCandle({candles:[...Array.from({length:4},(_,i)=>up(i)),{open:2,high:1,low:0,close:2}],price:1.2});
 assert.equal(result.calibratedCandles,4);
});
