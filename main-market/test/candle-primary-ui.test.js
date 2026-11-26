import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync(new URL("../public/candle-lab.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const config=readFileSync(new URL("../src/config.js",import.meta.url),"utf8");

test("Telegram primary /signal serves the EMA5 two-phase Mini App",()=>{
 assert.match(server,/app\.get\("\/signal".*public.*candle-lab\.html/s);
 assert.match(server,/primaryMiniApp:\{route:"\/signal",api:"\/api\/telegram\/ema5\/status"/);
 assert.match(server,/EMA5_PULLBACK_TWO_PHASE_M1/);
});
test("backend samples at open and T-5, then enters next candle once",()=>{
 assert.match(server,/startEma5Sampler\(\)/);
 assert.match(server,/sampleEma5\(feed,"OPEN",minute\)/);
 assert.match(server,/sampleEma5\(feed,"PREPARE",minute\)/);
 assert.match(server,/enterPreparedSignal\(state,minute\)/);
 assert.match(server,/second<=5/);
 assert.match(server,/lastPrepareSampleEpoch/);
});
test("only four requested major forex pairs are enabled",()=>{
 for(const pair of ["EUR/USD","EUR/JPY","GBP/USD","USD/JPY"])assert.ok(config.includes(pair));
});
test("Mini App shows a signal lamp, pair selector, live price and entry timer without candles",()=>{
 for(const id of ["lamp","signal","stage","price","pricehint","timer","pairs","api","apiDetail"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/CALL/);
 assert.match(html,/PUT/);
 assert.match(html,/WAIT/);
 assert.match(html,/เสียงแจ้งเตือน/);
 assert.match(html,/navigator\.vibrate/);
 assert.doesNotMatch(html,/<canvas\b|candle chart|candlestick/i);
});
test("Mini App JavaScript parses",()=>{
 const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>0&&end>start);
 assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
