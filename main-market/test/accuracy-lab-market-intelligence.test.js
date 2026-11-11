import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarketIntelligence } from "../src/accuracy-lab/market-intelligence.js";
const make=(values)=>{let p=1.1;return values.map(v=>{const o=p,c=p+v;p=c;return{open:o,close:c,high:Math.max(o,c)+.00003,low:Math.min(o,c)-.00003};});};
test("fails closed on insufficient and malformed history",()=>{assert.equal(analyzeMarketIntelligence([]).ready,false);const bad=Array.from({length:45},()=>({open:1,high:0,low:1,close:1}));assert.equal(analyzeMarketIntelligence(bad).ready,false);});
test("flat overlapping candles activate sideway guard",()=>{const c=Array.from({length:50},()=>({open:1.1,high:1.1001,low:1.0999,close:1.1}));const r=analyzeMarketIntelligence(c);assert.equal(r.ready,true);assert.ok(["SIDEWAY","UNCLEAR","TRANSITION"].includes(r.regime));assert.equal(r.ready,true);});
test("strong directional sequence is classified by Accuracy Lab",()=>{const r=analyzeMarketIntelligence(make(Array(50).fill(.0002)));assert.equal(r.ready,true);assert.equal(r.regime,"UPTREND");assert.equal(r.ready,true);});
test("outputs diagnostics for both directions and every setup family",()=>{const r=analyzeMarketIntelligence(make(Array(50).fill(.0001)));assert.equal(r.candidates.length,8);assert.ok(r.structure);});
