import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const serverJs=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Mini App exposes native Partial Scoring 59/45 and removes Gemini controls",()=>{
 assert.match(html,/SIGNAL ENGINE/);
 assert.doesNotMatch(html,/gemini/i);
 assert.match(html,/CALL\/PUT ≥ 59/);
 assert.match(html,/id="scoreStatus"/);
 assert.match(html,/id="indicatorStatus"/);
 assert.doesNotMatch(serverJs,/gemini_on|gemini_off|analyzeWithGemini|Gemini/);
});
test("Mini App still controls Twelve Data monitoring and retains manual lamp",()=>{
 assert.match(html,/await control\("start"\)/);
 assert.match(html,/const action=latest\.monitoring\?"stop":"start"/);
 assert.match(html,/manualLampToggle/);
 assert.match(serverJs,/fetchCandles/);
});
test("Mini App inline script parses and all referenced DOM IDs exist",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.indexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>="<script>".length&&end>start);
 assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("Backend health metadata declares native scoring with no external AI",()=>{
 assert.match(serverJs,/decisionEngine: "TWELVE_DATA_NATIVE_PARTIAL_SCORING_59"/);
 assert.match(serverJs,/signalGeneration: true/);
 assert.match(serverJs,/externalAiCalls: false/);
 assert.match(serverJs,/callPut: 59/);
});
