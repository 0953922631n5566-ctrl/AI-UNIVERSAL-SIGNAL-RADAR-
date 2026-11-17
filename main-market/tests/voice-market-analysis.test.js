import test from "node:test";
import assert from "node:assert/strict";
import { analyzeM1Voice } from "../src/voice-market-analysis.js";

function candles(direction="UP", count=30) {
  return Array.from({length:count},(_,i)=>{
    const open=1.08000+i*0.0001;
    const close=open+(direction==="UP"?0.00008:-0.00008);
    return {epoch:Math.floor(Date.now()/60000)*60-(count-i)*60,open,high:Math.max(open,close)+0.00002,low:Math.min(open,close)-0.00002,close};
  });
}
test("M1 voice analysis returns candle, trend, momentum and Thai speech text",()=>{
 const result=analyzeM1Voice(candles("UP"),{now:Date.now()});
 assert.equal(result.ok,true);
 assert.equal(result.interval,"1min");
 assert.ok(["UP","DOWN","SIDEWAY"].includes(result.outlook));
 assert.ok(Number.isFinite(result.levels.recentResistance));
});
test("M1 voice analysis waits when fewer than 20 valid candles are available",()=>{
 const result=analyzeM1Voice(candles("UP",8));
 assert.equal(result.ok,false);
 assert.equal(result.status,"WAITING_FOR_DATA");
});
test("provisional candle is identified as still forming",()=>{
 const rows=candles("DOWN");rows.at(-1).provisional=true;
 const result=analyzeM1Voice(rows);
 assert.equal(result.candle.provisional,true);
 assert.ok(result.details.candle.includes("ก่อตัว"));
});
