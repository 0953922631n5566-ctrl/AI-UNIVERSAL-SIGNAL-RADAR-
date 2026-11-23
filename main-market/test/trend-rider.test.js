import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrendRider } from "../src/trend-rider.js";

const baseEpoch=Date.parse("2026-11-23T12:00:00Z")/1000;
function risingCandles(count=54){return Array.from({length:count},(_,i)=>{const close=1.1+i*.00005;return{epoch:baseEpoch+i*60,open:close-.00008,close,high:close+.00004,low:close-.00012,live:false};});}
function indicators(candles,direction="UP"){
 const rows=candles.slice(-4),last=rows.at(-1).close;
 return{
  ema5Values:rows.map((c,i)=>({epoch:c.epoch,ema:direction==="FLAT"?1.1:last-.00001-(3-i)*.00001})),
  ema20Values:rows.map((c,i)=>({epoch:c.epoch,ema:direction==="UP"?last-.00022-(3-i)*.00001:direction==="DOWN"?last+.00022+(3-i)*.00001:1.1})),
  atrValues:rows.map(c=>({epoch:c.epoch,atr:.00016}))
 };
}
test("Engine 3 requires valid closed OHLC history and native Twelve Data indicators",()=>{
 const candles=risingCandles(20),r=analyzeTrendRider(candles,indicators(candles));
 assert.equal(r.ready,false);assert.equal(r.signal,null);
 const enough=risingCandles(),missing=analyzeTrendRider(enough);
 assert.equal(missing.status,"TWELVE_DATA_INDICATORS_NOT_READY");
});
test("Engine 3 detects sustained rising trend using Twelve Data EMA5/EMA20/ATR14",()=>{
 const candles=risingCandles(),r=analyzeTrendRider(candles,indicators(candles));
 assert.equal(r.ready,true);assert.equal(r.signal,"CALL");assert.ok(r.score>=58);
 assert.equal(r.provider,"TWELVE_DATA_NATIVE_INDICATORS");
 assert.equal(r.metrics.ema5Source,"Twelve Data /ema time_period=5");
});
test("Engine 3 fails closed on malformed OHLC data",()=>{
 const candles=risingCandles();candles.at(-1).low=candles.at(-1).high+1;
 const r=analyzeTrendRider(candles,indicators(candles));assert.equal(r.ready,false);assert.equal(r.signal,null);
});
test("Engine 3 detects sustained falling trend as PUT",()=>{
 const candles=Array.from({length:54},(_,i)=>{const close=1.2-i*.00005;return{epoch:baseEpoch+i*60,open:close+.00008,close,high:close+.00012,low:close-.00004,live:false};});
 const rows=candles.slice(-4),last=rows.at(-1).close;
 const values={ema5Values:rows.map((c,i)=>({epoch:c.epoch,ema:last+.00001+(3-i)*.00001})),ema20Values:rows.map((c,i)=>({epoch:c.epoch,ema:last+.00022+(3-i)*.00001})),atrValues:rows.map(c=>({epoch:c.epoch,atr:.00016}))};
 const r=analyzeTrendRider(candles,values);assert.equal(r.signal,"PUT");assert.ok(r.score>=58);
});
test("Engine 3 blocks a flat sideways market",()=>{
 const candles=Array.from({length:54},(_,i)=>({epoch:baseEpoch+i*60,open:1.1,close:1.1,high:1.10004,low:1.09996,live:false}));
 const rows=candles.slice(-4),values={ema5Values:rows.map(c=>({epoch:c.epoch,ema:1.1})),ema20Values:rows.map(c=>({epoch:c.epoch,ema:1.1})),atrValues:rows.map(c=>({epoch:c.epoch,atr:.00016}))};
 const r=analyzeTrendRider(candles,values);assert.equal(r.signal,null);assert.equal(r.status,"SIDEWAYS_BLOCK");
});
test("Engine 3 rejects stale or misaligned Twelve Data indicator values",()=>{
 const candles=risingCandles(),values=indicators(candles);values.atrValues=values.atrValues.map(v=>({...v,epoch:v.epoch-60}));
 const r=analyzeTrendRider(candles,values);assert.equal(r.ready,false);assert.equal(r.status,"TWELVE_DATA_INDICATORS_STALE");
});
