import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("primary Telegram Mini App uses the indicator-free custom candle-lines engine",()=>{
 assert.match(html,/EUR \/ USD/);assert.match(html,/id="signal"/);
 assert.doesNotMatch(html,/id="candleChart"|class="chart-panel"/);
 assert.match(html,/CUSTOM CANDLE LINES · SCORE 80\/100/);
 assert.match(html,/m\.candleLines/);
 assert.doesNotMatch(html,/EMA5|RSI\(14\)|m\.indicators/);
 assert.match(server,/app\.get\("\/signal".*public.*signal\.html/s);
});
test("Mini App controls scanner without a pair selector",()=>{
 assert.match(html,/\/api\/telegram\/control/);assert.doesNotMatch(html,/<select\b|id="pairs"/);
 assert.match(server,/\/api\/telegram\/candle-lines\/status/);assert.match(server,/symbols:\["EUR\/USD"\]/);
});
test("Mini App inline script parses and all referenced DOM IDs exist",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>0&&end>start);assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("backend health metadata declares custom OHLC geometry and no external AI",()=>{
 assert.match(server,/decisionEngine:"EURUSD_CUSTOM_CANDLE_LINES_M1"/);
 assert.match(server,/primaryDecisionEngine:"CUSTOM_PER_CANDLE_GEOMETRY_LINES_THRESHOLD_50_HIGH_FREQUENCY"/);
 assert.match(server,/indicators:\[\]/);assert.match(server,/externalAiCalls:false/);
});
