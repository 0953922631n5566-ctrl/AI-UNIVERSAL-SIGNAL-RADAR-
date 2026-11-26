import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/candle-lab.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const config=readFileSync(new URL("../src/config.js",import.meta.url),"utf8");
test("Telegram primary /signal serves the EUR/USD EMA5 S/R Mini App",()=>{
 assert.match(server,/app\.get\("\/signal".*public.*candle-lab\.html/s);
 assert.match(server,/primaryMiniApp:\{route:"\/signal",api:"\/api\/telegram\/ema5\/status"/);
 assert.match(server,/EURUSD_EMA5_PULLBACK_SR_TWO_PHASE_M1/);
 assert.match(config,/Object\.freeze\(\["EUR\/USD"\]\)/);
});
test("backend samples at open and T-5, then enters next candle once",()=>{
 assert.match(server,/startEma5Sampler\(\)/);assert.match(server,/sampleEma5\(feed,"OPEN",minute\)/);
 assert.match(server,/sampleEma5\(feed,"PREPARE",minute\)/);assert.match(server,/enterPreparedSignal\(state,minute\)/);assert.match(server,/second<=5/);
});
test("Mini App displays EUR/USD only, key status, S/R and mini chart",()=>{
 for(const id of ["signal","phase","price","timer","api","apiDetail","chart","history","ema","support","resistance","key"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/PREPARE/);assert.match(html,/ENTER NOW/);assert.match(html,/<canvas\b/i);
});
test("Mini App JavaScript parses",()=>{const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");assert.ok(start>0&&end>start);assert.doesNotThrow(()=>new Script(html.slice(start,end)));});
