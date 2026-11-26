import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/candle-lab.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("primary Telegram Mini App is the EUR/USD EMA5 + S/R chart interface",()=>{
 assert.match(html,/EUR\/USD RADAR/);assert.match(html,/id="chart"/);assert.match(html,/id="history"/);
 assert.match(html,/id="signal"/);assert.match(html,/EMA 5 PULLBACK · LOCAL S\/R · M1/);
 assert.match(server,/app\.get\("\/signal".*candle-lab\.html/s);
});
test("Mini App controls scanner without a pair selector",()=>{
 assert.match(html,/\/api\/telegram\/control/);assert.doesNotMatch(html,/<select\b|id="pairs"/);
 assert.match(server,/\/api\/telegram\/ema5\/status/);assert.match(server,/symbols:\["EUR\/USD"\]/);
});
test("Mini App inline script parses and all referenced DOM IDs exist",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>0&&end>start);assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("backend health metadata declares EUR/USD EMA5 S/R and no external AI",()=>{
 assert.match(server,/decisionEngine:"EURUSD_EMA5_PULLBACK_SR_TWO_PHASE_M1"/);
 assert.match(server,/primaryDecisionEngine:"EMA5_PULLBACK_WITH_LOCAL_SWING_SR"/);assert.match(server,/externalAiCalls:false/);
});
