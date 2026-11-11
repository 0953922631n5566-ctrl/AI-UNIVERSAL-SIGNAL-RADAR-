import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarketIntelligence } from "../src/accuracy-lab/market-intelligence.js";
const make=(step,count=50)=>{let p=1.1;return Array.from({length:count},()=>{const open=p,close=p+step;p=close;return{open,close,high:Math.max(open,close)+.00003,low:Math.min(open,close)-.00003};});};

test("fails closed on insufficient and malformed history",()=>{
 assert.equal(analyzeMarketIntelligence([]).ready,false);
 const bad=Array.from({length:45},()=>({open:1,high:0,low:1,close:1}));
 assert.equal(analyzeMarketIntelligence(bad).ready,false);
});
test("flat overlapping candles are blocked and cannot produce a direction",()=>{
 const c=Array.from({length:50},()=>({open:1.1,high:1.1001,low:1.0999,close:1.1}));
 const r=analyzeMarketIntelligence(c);
 assert.equal(r.ready,true);assert.equal(r.setup,null);assert.equal(r.trendOnly,true);assert.equal(r.allowedDirection,null);
});
test("strong higher-high/higher-low sequence allows CALL only",()=>{
 const r=analyzeMarketIntelligence(make(.0002));
 assert.equal(r.ready,true);assert.equal(r.regime,"UPTREND");assert.equal(r.allowedDirection,"CALL");
 assert.ok(r.candidates.every(v=>v.direction!=="PUT"||v.score===0));
 assert.ok(r.candidates.every(v=>v.setup!=="REVERSAL"));
 assert.ok(r.structure.higherHigh&&r.structure.higherLow);
});
test("strong lower-high/lower-low sequence allows PUT only",()=>{
 const r=analyzeMarketIntelligence(make(-.0002));
 assert.equal(r.ready,true);assert.equal(r.regime,"DOWNTREND");assert.equal(r.allowedDirection,"PUT");
 assert.ok(r.candidates.every(v=>v.direction!=="CALL"||v.score===0));
 assert.ok(r.candidates.every(v=>v.setup!=="REVERSAL"));
 assert.ok(r.structure.lowerHigh&&r.structure.lowerLow);
});
test("counter-trend reversal is never selected",()=>{
 const c=make(.0002),last=c.at(-1);
 last.open=last.close+.00002;last.close=last.open-.00002;last.high=last.open+.00001;last.low=last.close-.00001;
 const r=analyzeMarketIntelligence(c);
 assert.notEqual(r.setup?.direction,"PUT");
});
test("only pullback, continuation and breakout-retest families remain",()=>{
 const r=analyzeMarketIntelligence(make(.0001));
 assert.deepEqual([...new Set(r.candidates.map(v=>v.setup))].sort(),["BREAKOUT_RETEST","CONTINUATION","PULLBACK"]);
});
