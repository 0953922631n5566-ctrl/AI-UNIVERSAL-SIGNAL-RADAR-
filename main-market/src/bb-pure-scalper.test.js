import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBBPureScalper } from "./bb-pure-scalper.js";
function history(n=25,base=1.1){return Array.from({length:n},(_,i)=>({epoch:i*60,open:base,high:base+.0002,low:base-.0002,close:base}));}
test("rejects insufficient and malformed history",()=>{assert.equal(analyzeBBPureScalper([]).ready,false);const xs=history();xs[0].high=0;assert.equal(analyzeBBPureScalper(xs).ready,false);});
test("valid history returns standalone pressure diagnostics",()=>{const r=analyzeBBPureScalper(history());assert.equal(r.strategy,"BB_PURE_SCALPER_STANDALONE");assert.equal(r.ready,true);assert.ok(Number.isFinite(r.metrics.buyingPressure));assert.ok(Number.isFinite(r.metrics.sellingPressure));});
test("touch without rejection does not trigger reversal",()=>{const xs=history();xs.push({epoch:1500,open:1.1,high:1.1002,low:1.0990,close:1.0991});assert.equal(analyzeBBPureScalper(xs).signal,"STANDBY");});
test("ignores live in-progress candle",()=>{const xs=history();xs.push({epoch:1500,open:1.1,high:1.2,low:1,close:1.15,live:true});assert.equal(analyzeBBPureScalper(xs).metrics.lastClosedCandleEpoch,1440);});