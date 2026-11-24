import test from "node:test";
import assert from "node:assert/strict";
import { scoreMarket } from "../src/advanced-scoring.js";
function fixture(count=54){
 const start=Math.floor(Date.now()/60000)*60-count*60;const candles=[];let previous=1.08;
 for(let i=0;i<count;i++){const open=previous,close=open+0.0001,epoch=start+i*60;candles.push({epoch,open,high:close+0.00005,low:open-0.00005,close,live:false});previous=close;}
 const last=candles.at(-1),prior=candles.slice(-8,-2),swingLow=Math.min(...prior.map(c=>c.low));last.low=swingLow-0.00015;return candles;
}
function native(candles){
 const tail=candles.slice(-4),last=candles.at(-1);
 return{ema5:tail.map((c,i)=>({epoch:c.epoch,ema:last.close-0.0006+i*0.0001})),
 ema20:tail.slice(-2).map((c,i)=>({epoch:c.epoch,ema:last.close-0.0012+i*0.0001})),
 atr14:Array.from({length:34},(_,i)=>({epoch:last.epoch-(33-i)*60,atr:0.0003}))};
}
test("native indicators must be complete, consecutive and aligned with latest closed M1 candle",()=>{
 const c=fixture(),v=native(c);assert.equal(scoreMarket(c,v).indicatorStatus.status,"READY");
 const stale=structuredClone(v);stale.ema5.at(-1).epoch-=60;assert.equal(scoreMarket(c,stale).signal,"STANDBY");
});
test("restored 30/30/20/20 formula releases directional scores at 59",()=>{
 const c=fixture(),r=scoreMarket(c,native(c));assert.equal(r.thresholds.signal,59);assert.equal(r.thresholds.prepare,45);
 assert.deepEqual(Object.keys(r.components),["ema5SlopeReversal","srFakeout","proximityMomentum","trendContext"]);
 assert.ok(r.scores.CALL>=59,JSON.stringify(r.scores));assert.equal(r.signal,"CALL");
 assert.equal(r.provider,"TWELVE_DATA_NATIVE_INDICATORS");
});
test("choppy kill switch suppresses CALL/PUT",()=>{
 const c=fixture(),v=native(c);v.ema5=v.ema5.map(x=>({...x,ema:c.at(-1).close-0.0001}));v.ema20=v.ema20.map(x=>({...x,ema:c.at(-1).close-0.00011}));
 const r=scoreMarket(c,v);assert.equal(r.signal,"STANDBY");assert.ok(r.riskFlags.includes("CHOPPY_MARKET_KILL_SWITCH"));
});
test("abnormal ATR range suppresses CALL/PUT",()=>{
 const c=fixture();c.at(-1).high+=0.002;const r=scoreMarket(c,native(c));assert.equal(r.signal,"STANDBY");assert.ok(r.riskFlags.includes("HIGH_ATR_SPIKE_KILL_SWITCH"));
});
