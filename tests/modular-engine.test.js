'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const{ema}=require('../indicators/ema'),{rsi}=require('../indicators/rsi'),{adx}=require('../indicators/adx');
const{scanTrend}=require('../scanner/trend-scanner'),{routeStrategy}=require('../engine/strategy-router'),{decide}=require('../engine/decision-engine'),{createSignalCache}=require('../engine/signal-cache'),{analyzeMarket}=require('../engine/analyze-market');
function mk(values){return values.map((close,i)=>({time:i*60000,open:close-.0001,high:close+.0002,low:close-.0002,close}));}
test('EMA needs sufficient history',()=>assert.equal(ema([1,2],3),null));
test('RSI rising sequence is bounded',()=>assert.equal(rsi(Array.from({length:20},(_,i)=>i+1)),100));
test('ADX needs sufficient candles',()=>assert.equal(adx(mk(Array.from({length:20},(_,i)=>i+1))),null));
test('scanner fails closed below 200 candles',()=>assert.equal(scanTrend(mk([1,2,3])).regime,'UNCLEAR'));
test('router never runs a strategy for UNCLEAR',()=>assert.equal(routeStrategy({regime:'UNCLEAR'}).signal,'STANDBY'));
test('decision engine blocks unclear regime',()=>assert.equal(decide({regime:'UNCLEAR'},null).signal,'STANDBY'));
test('RAM cache is keyed by candle timestamp',()=>{const c=createSignalCache();c.set(1,{signal:'CALL'});assert.equal(c.get(1).signal,'CALL');assert.equal(c.get(2),null);});
test('full analyzer always returns valid signal enum',()=>{const x=analyzeMarket(mk(Array.from({length:200},(_,i)=>1+i*.00001)));assert.ok(['CALL','PUT','STANDBY'].includes(x.signal));});
