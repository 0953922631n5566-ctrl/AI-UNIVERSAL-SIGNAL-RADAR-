import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const serverJs=readFileSync(new URL("../server.js",import.meta.url),"utf8");

test("Mini App is minimal on the home screen and keeps controls in the menu",()=>{
 const body=html.slice(html.indexOf("<body>"),html.indexOf("<script>"));
 const drawerStart=body.indexOf('<aside id="drawer"');
 assert.ok(drawerStart>0);
 const home=body.slice(0,drawerStart),drawer=body.slice(drawerStart);
 for(const id of ["api","price","age","lampShell","signal","hint","candle","expiry","menuButton"])assert.match(home,new RegExp('id="'+id+'"'));
 for(const id of ["monitorToggle","soundEnable","engineSignal","ema5","ema20","atr14","apiKeys","reason","trendCard","manualLampToggle","manualLampStatus"])assert.match(drawer,new RegExp('id="'+id+'"'));
 assert.match(home,/EUR \/ USD/);
 assert.doesNotMatch(home,/GEMINI PRIMARY|EMA 9|SOUND & HAPTICS|CONTROL CENTER|API POOL STATUS/);
});
test("Mini App automatically authenticates and starts monitoring",()=>{
 assert.match(html,/async function autoStart\(\)/);
 assert.match(html,/await control\("start"\)/);
 assert.match(html,/\/api\/telegram\/session/);
 assert.match(serverJs,/if \(action === "start"\)/);
});
test("Mini App reuses session and supports manual stop/restart",()=>{
 assert.match(html,/function ensureAuth\(\)\{if\(token\)return Promise\.resolve\(\)/);
 assert.match(html,/authRetryAfter/);
 assert.match(html,/const action=latest\.monitoring\?"stop":"start"/);
});
test("Mini App exposes Gemini and local OHLC diagnostics",()=>{
 for(const id of ["engineSignal","regime","ema5","ema20","atr14","candles","geminiQuota","reason","apiSummary","apiPool","apiKeys"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/GEMINI PRIMARY · NEXT M1/);
 assert.match(html,/EMA 9 · Local OHLC/);
 assert.match(html,/signalRadarManualLampColor/);
 assert.match(serverJs,/analyzeWithGemini/);
 assert.doesNotMatch(serverJs,/fetchTrendEma5|fetchEma20|fetchAtr14/);
});
test("Mini App displays next-M1 target and retains sound/haptics",()=>{
 assert.match(serverJs,/signalTimingMode: "NEXT_M1_TARGET_PREOPEN_HOLD_30S"/);
 assert.match(serverJs,/targetCandleEpoch: active\.targetCandleEpoch/);
 assert.match(html,/function notify\(/);
 assert.match(html,/signalExpiresAt/);
 assert.match(html,/navigator\.vibrate/);
 assert.match(html,/function countdown\(/);
});
test("Mini App inline script parses and all referenced DOM IDs exist",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.indexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>="<script>".length&&end>start);
 assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("Backend is Gemini-primary, next-M1 only and manual-only",()=>{
 assert.match(serverJs,/analyzeWithGemini\(/);
 assert.match(serverJs,/createNextCandleSignal\(/);
 assert.match(serverJs,/canDispatchNextCandleSignal\(/);
 assert.match(serverJs,/decisionEngine: "GEMINI_PRIMARY_ADAPTIVE_NEXT_M1"/);
 assert.match(serverJs,/brokerExecution: false/);
 for(const legacy of [/analyzeMarket\(/,/analyzeBBPureScalper\(/,/analyzeEarlyEntryEngine4\(/,/ENGINE4_STRATEGY/,/selectRecoveryCandidate\(/,/evaluateM1Outcome\(/])assert.doesNotMatch(serverJs,legacy);
});
