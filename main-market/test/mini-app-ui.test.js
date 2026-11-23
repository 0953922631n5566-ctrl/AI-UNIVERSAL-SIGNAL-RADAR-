import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../public/signal.html",import.meta.url),"utf8");
const serverJs=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("Mini App exposes only the Engine 3 Trend Rider analyzer",()=>{
 assert.match(html,/ENGINE 3 · TREND RIDER/);assert.match(html,/id="trendCard"/);
 for(const id of ["v1Card","bbCard","engine4Card","v1Signal","bbSignal","engine4Signal"])assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(html,/ENGINE_4|V1 ORIGINAL|BB PURE SCALPER|MOMENTUM 9/);
});
test("Mini App displays Twelve Data native EMA5 EMA20 ATR14 and analysis evidence",()=>{
 for(const id of ["ema5Value","ema20Value","atr14Value","indicatorStatus","emaGapAtrValue","extensionAtrValue","bodyRatioValue","priorHighValue","priorLowValue"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/TWELVE DATA EMA 5/);assert.match(html,/Twelve Data native endpoints/);
});
test("Manual red green switch is independent from the actual signal lamp",()=>{
 assert.match(html,/id="monitorToggle"/);assert.match(html,/id="monitorStatus"/);assert.match(html,/\/api\/telegram\/control/);
 assert.match(html,/id="manualLampToggle"/);assert.match(html,/id="manualLampStatus"/);
 assert.match(html,/signalRadarManualLampColor/);assert.match(html,/ไม่เปลี่ยนผลวิเคราะห์ CALL\/PUT/);
});
test("Mini App keeps T-10 prepare, T-5 signal timing, sound vibration and 30 second hold",()=>{
 assert.match(html,/m\.preAlertStatus==="PREPARE_ALERT"/);assert.match(html,/function triggerSignalAlert/);
 assert.match(html,/signalExpiresAt/);assert.match(html,/navigator\.vibrate/);assert.match(html,/holdMs/);
 assert.match(html,/T-10 PREPARE alert/);assert.match(html,/function countdown\(/);assert.match(html,/remain=seconds%60/);
});
test("Mini App script only references existing DOM elements and parses",()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...html.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!ids.has(x)))],[]);
 const start=html.indexOf("<script>")+"<script>".length,end=html.lastIndexOf("</script>");
 assert.ok(start>="<script>".length&&end>start);assert.doesNotThrow(()=>new Script(html.slice(start,end)));
});
test("Backend contains a single Engine 3 analysis path with native indicator endpoints",()=>{
 assert.match(serverJs,/analyzeTrendRider\(closed/);assert.match(serverJs,/fetchTrendEma5/);
 assert.match(serverJs,/fetchEma20/);assert.match(serverJs,/fetchAtr14/);
 assert.match(serverJs,/decisionEngine: "ENGINE_3_TREND_RIDER_ONLY"/);
 for(const legacy of [/analyzeMarket\(/,/analyzeBBPureScalper\(/,/analyzeEarlyEntryEngine4\(/,/ENGINE4_STRATEGY/,/selectRecoveryCandidate\(/,/evaluateM1Outcome\(/])assert.doesNotMatch(serverJs,legacy);
});

test("Mini App keeps only EUR/USD price, live API status, signal lamp and countdown on the main screen",()=>{
 const body=html.slice(html.indexOf("<body>"),html.indexOf("<script>"));
 const menuStart=body.indexOf('<details class="menu-drawer" id="settingsMenu">');
 const menuEnd=body.indexOf("</div></details>",menuStart);
 assert.ok(menuStart>0&&menuEnd>menuStart);
 const mainScreen=body.slice(0,menuStart),menu=body.slice(menuStart,menuEnd);
 for(const id of ["api","price","panel","signal","candle","expiry"])assert.match(mainScreen,new RegExp('id="'+id+'"'));
 for(const id of ["soundEnable","monitorToggle","trendCard","ema5Value","manualLampToggle","apiKeys"])assert.match(menu,new RegExp('id="'+id+'"'));
 assert.match(mainScreen,/EUR \/ USD/);assert.match(mainScreen,/LIVE PRICE/);
 assert.doesNotMatch(mainScreen,/ENGINE 3|SOUND & ALERT|SYSTEM CONTROL|EMA 5|MANUAL LIGHT SWITCH/);
});
