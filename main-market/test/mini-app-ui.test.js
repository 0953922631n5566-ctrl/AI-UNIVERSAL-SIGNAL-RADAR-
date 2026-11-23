import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const serverJs=readFileSync(new URL("../server.js",import.meta.url),"utf8");

test("Mini App is a new minimal interface with only market, price, lamp and countdown on the home screen",()=>{
 const body=html.slice(html.indexOf("<body>"),html.indexOf("<script>"));
 const drawerStart=body.indexOf('<aside id="drawer"');
 assert.ok(drawerStart>0);
 const home=body.slice(0,drawerStart),drawer=body.slice(drawerStart);
 for(const id of ["api","price","age","lampShell","signal","hint","candle","expiry","menuButton"])assert.match(home,new RegExp('id="'+id+'"'));
 for(const id of ["monitorToggle","soundEnable","engineSignal","ema5","ema20","atr14","apiKeys","reason","trendCard","manualLampToggle","manualLampStatus"])assert.match(drawer,new RegExp('id="'+id+'"'));
 assert.match(home,/EUR \/ USD/);
 assert.doesNotMatch(home,/ENGINE 3|EMA 5|SOUND & HAPTICS|CONTROL CENTER|API POOL STATUS/);
 assert.match(html,/class="lamp-shell"/);
});

test("Mini App automatically authenticates and starts monitoring when opened",()=>{
 assert.match(html,/async function autoStart\(\)/);
 assert.match(html,/autoStart\(\);setInterval\(\(\)=>\{if\(!bootStartCompleted\)autoStart\(\);\},5000\);setInterval\(poll,1200\)/);
 assert.match(html,/await control\("start"\)/);
 assert.match(html,/\/api\/telegram\/session/);
 assert.match(html,/\/api\/telegram\/control/);
 assert.match(serverJs,/if \(action === "start"\)/);
});

test("Mini App reuses its session token instead of requesting a new session on every poll",()=>{
 assert.match(html,/function ensureAuth\(\)\{if\(token\)return Promise\.resolve\(\)/);
 assert.match(html,/authRetryAfter/);
 assert.match(html,/r\.status===429/);
 assert.match(html,/Retry-After/);
});

test("Manual stop and restart remain available only in the menu",()=>{
 const drawer=html.slice(html.indexOf('<aside id="drawer"'),html.indexOf('<div id="toast"'));
 assert.match(drawer,/id="monitorToggle"/);
 assert.match(html,/const action=latest\.monitoring\?"stop":"start"/);
});

test("Mini App retains Engine 3 native Twelve Data diagnostics in the menu",()=>{
 for(const id of ["engineSignal","regime","ema5","ema20","atr14","candles","reason","apiSummary","apiPool","apiKeys"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/ENGINE 3 · TREND RIDER/);
 assert.match(html,/Twelve Data/);
 assert.match(html,/signalRadarManualLampColor/);
 assert.match(html,/แยกจากสัญญาณจริง/);
 assert.match(serverJs,/fetchTrendEma5/);
 assert.match(serverJs,/fetchEma20/);
 assert.match(serverJs,/fetchAtr14/);
});

test("Mini App preserves M1 countdown, PREPARE, signal alerts, sound and vibration",()=>{
 for(const id of ["candle","expiry"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/m\.preAlertStatus==="PREPARE_ALERT"/);
 assert.match(html,/function notify\(/);
 assert.match(html,/signalExpiresAt/);
 assert.match(html,/navigator\.vibrate/);
 assert.match(html,/function countdown\(/);
 assert.match(html,/30/);
});

test("Mini App inline script parses and every referenced DOM id exists",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.indexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>="<script>".length&&end>start);
 assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});

test("Backend contains a single Engine 3 analysis path with native indicator endpoints and no broker execution",()=>{
 assert.match(serverJs,/analyzeTrendRider\(closed/);
 assert.match(serverJs,/fetchTrendEma5/);
 assert.match(serverJs,/fetchEma20/);
 assert.match(serverJs,/fetchAtr14/);
 assert.match(serverJs,/decisionEngine: "ENGINE_3_TREND_RIDER_ONLY"/);
 assert.match(serverJs,/brokerExecution: false/);
 for(const legacy of [/analyzeMarket\(/,/analyzeBBPureScalper\(/,/analyzeEarlyEntryEngine4\(/,/ENGINE4_STRATEGY/,/selectRecoveryCandidate\(/,/evaluateM1Outcome\(/])assert.doesNotMatch(serverJs,legacy);
});
