import test from "node:test";import assert from "node:assert/strict";import{analyzeMarket,ema,rsi}from"../src/analyzer.js";
const candles=(n=90,step=.00001)=>Array.from({length:n},(_,i)=>{const close=1.08+i*step,epoch=Math.floor(Date.now()/60000)*60-(n-i)*60;return{time:new Date(epoch*1000).toISOString().slice(0,16).replace("T"," "),epoch,open:close-step/3,high:close+step,low:close-step,close}});
test("EMA waits for enough observations",()=>assert.equal(ema([1,2],3),null));
test("RSI is bounded",()=>{const x=rsi(Array.from({length:30},(_,i)=>1+i*.01));assert.ok(x>=0&&x<=100)});
test("insufficient history returns STANDBY",()=>assert.equal(analyzeMarket(candles(20)).signal,"STANDBY"));
test("fresh data returns explainable state without fake confidence",()=>{const x=analyzeMarket(candles());assert.ok(["CALL","PUT","STANDBY"].includes(x.signal));assert.ok(x.regime);assert.ok(Array.isArray(x.evidence));assert.equal("confidence"in x,false)});
test("stale candles return STANDBY",()=>{const x=candles();x.at(-1).epoch-=600;assert.equal(analyzeMarket(x,{maxAgeSeconds:180}).signal,"STANDBY")});