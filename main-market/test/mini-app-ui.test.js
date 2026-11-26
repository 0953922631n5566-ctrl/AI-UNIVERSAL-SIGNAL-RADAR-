import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/candle-lab.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("primary Telegram Mini App is the signal-lights-only EMA5 two-phase interface",()=>{
 assert.match(html,/EMA 5 · M1 · NON-OTC/);
 assert.match(html,/id="lamp"/);
 assert.match(html,/id="signal"/);
 assert.match(html,/id="stage"/);
 assert.doesNotMatch(html,/<canvas\b|id="history"/i);
 assert.match(html,/navigator\.vibrate/);
 assert.match(server,/app\.get\("\/signal".*candle-lab\.html/s);
});
test("Mini App controls the Twelve Data monitor and pair selector",()=>{
 assert.match(html,/\/api\/telegram\/control/);
 assert.match(html,/\/api\/telegram\/select/);
 assert.match(server,/\/api\/telegram\/ema5\/status/);
});
test("Mini App inline script parses and all referenced DOM IDs exist",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.lastIndexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>0&&end>start);
 assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("backend health metadata declares EMA5 and no external AI",()=>{
 assert.match(server,/decisionEngine:"EMA5_PULLBACK_TWO_PHASE_M1"/);
 assert.match(server,/primaryDecisionEngine:"EMA5_ONLY"/);
 assert.match(server,/externalAiCalls:false/);
});
