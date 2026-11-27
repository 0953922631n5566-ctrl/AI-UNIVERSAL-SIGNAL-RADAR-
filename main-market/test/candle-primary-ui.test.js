import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const lab=readFileSync(new URL("../public/candle-lab.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const config=readFileSync(new URL("../src/config.js",import.meta.url),"utf8");
test("Telegram primary /signal serves the EUR/USD custom candle-lines Mini App",()=>{
 assert.match(server,/app\.get\("\/signal".*public.*signal\.html/s);
 assert.match(server,/app\.get\("\/signal-next".*candle-lab\.html/s);
 assert.match(server,/primaryMiniApp:\{route:"\/signal",api:"\/api\/telegram\/candle-lines\/status"/);
 assert.match(server,/EURUSD_CUSTOM_CANDLE_LINES_M1/);
 assert.match(config,/Object\.freeze\(\["EUR\/USD"\]\)/);
 assert.match(html,/CUSTOM CANDLE LINES · SCORE 80\/100/);
 assert.match(html,/m\.candleLines/);
 assert.doesNotMatch(html,/EMA5|RSI\(14\)|indicator\.rsi14/);
 assert.doesNotMatch(html,/id="candleChart"|class="chart-panel"/);
});
test("backend checks WATCH at T-10 and ORDER at T-5 for 30 seconds",()=>{
 assert.match(server,/startCandleLineSampler\(\)/);
 assert.match(server,/runCandleLineCheck\(feed, minute, "WATCH"\)/);
 assert.match(server,/runCandleLineCheck\(feed, minute, "ORDER"\)/);
 assert.match(server,/state\.orderUntil = now \+ 30000/);
});
test("Mini App keeps EUR/USD only and manual order execution",()=>{
 assert.match(server,/symbols:\["EUR\/USD"\]/);
 assert.match(server,/manualOnly:true/);assert.match(server,/brokerExecution:false/);
 assert.match(lab,/id="chart"/);
});
test("Mini App JavaScript parses and every referenced DOM ID exists",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>0&&end>start);assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
