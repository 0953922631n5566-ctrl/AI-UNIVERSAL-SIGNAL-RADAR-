import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const serverJs = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const configJs = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");

test("Mini App is restricted to EUR/USD and keeps API details inside a collapsible menu", () => {
  assert.match(html, /EUR \/ USD/);
  assert.match(html, /EUR \/ USD/);
  for (const symbol of ["AUD/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]) {
    assert.doesNotMatch(html, new RegExp(symbol.replace("/", "\\/")));
  }
  assert.match(html, /<details class="api-drawer" data-panel="api">/);
  assert.match(html, /apiKeys/);
});

test("Mini App presents closed-M1 next-candle entry and preserves shared sound, vibration and 30-second alert UI", () => {
  assert.match(html, /id="soundEnable"/);
  assert.match(html, /PREPARE \/ เฝ้าระวัง/);
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /m\.alertId/);
  assert.match(html, /function triggerSignalAlert/);
  assert.match(html, /signalExpiresAt/);
  assert.match(html, /holdMs/);
  assert.match(html, /alert-flash-call/);
  assert.match(html, /alert-flash-put/);
  assert.ok(html.includes("AWESOME OSCILLATOR 5/34"));
  assert.ok(html.includes("V1 + BB + TREND RIDER AI"));
  assert.match(html, /id="reversal"/);
  assert.match(html, /m\.scores\?\.CALL/);
  assert.match(html, /m\.engineResults/);
  assert.match(html, /m\.activeSignals/);
  for (const id of ["v1Card","bbCard","trendCard","trendSignal","engine4Card","engine4Signal","engine4Reason"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.ok(html.includes('<div class="engine-title">04 · AWESOME OSCILLATOR 5/34</div>'));
  assert.ok(html.includes("Engine 4 · AO 5/34 → T-5 CALL"));
  assert.ok(html.includes("Engine 4 · AO 5/34 → T-5 PUT"));
  assert.doesNotMatch(html, /ACCUMULATED PRESSURE/);
  assert.doesNotMatch(html, /Engine 4 · Price Action/);
  assert.match(html, /\.engine-card\.call\{border-color:var\(--call-color\)\}/);
  assert.match(html, /\.engine-card\.put\{border-color:var\(--put-color\)\}/);
  assert.match(html, /\.engine-card\.light-inverted\{--call-color:#39e879/);
  assert.match(html, /\.signal\.call\{background:linear-gradient\(135deg,#481b29/);
  assert.match(html, /\.signal\.put\{background:linear-gradient\(135deg,#103c2b/);
  assert.match(html, /\.call \.lamp\{background:#ff535b/);
  assert.match(html, /\.put \.lamp\{background:#39e879/);
  assert.match(html, /#alertToast\.real-call\{border-color:#ff535b/);
  assert.match(html, /#alertToast\.real-put\{border-color:#39e879/);
  assert.match(html, /BB\(20,2\)/);
  assert.match(html, /SCORING BREAKDOWN/);
  assert.doesNotMatch(html, /EMA 3\/8\/50|geminiQuota/);
});

test("Mini App identifies Partial Scoring and exposes weighted score breakdown", () => {
  assert.ok(html.includes("V1 + BB + TREND RIDER AI"));
  assert.match(html, /SCORING BREAKDOWN/);
  assert.match(html, /m\.scores\?\.PUT/);
  assert.match(html, /m\.engineResults/);
  assert.match(html, /m\.activeSignals/);
  assert.match(html, /id="v1Card"/);
  assert.match(html, /id="bbCard"/);
  assert.match(html, /id="trendCard"/);
  assert.match(html, /id="trendSignal"/);
  assert.match(html, /BB\(20,2\)/);
  assert.match(html, /m\.components\|\|\{\}/);
  assert.match(html, /m\.killSwitch/);
  assert.match(html, /V1 Partial Scoring/);
  assert.doesNotMatch(html, /EMA5 ONLY TREND FLOW/);
});


test("Mini App script only references DOM elements that exist in the fixed EUR/USD layout", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const references = [...html.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);
  const missing = [...new Set(references.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
  assert.doesNotMatch(html, /pairSelect|changePair/);
});

test("Mini App inline JavaScript parses successfully", () => {
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start, "expected an inline Mini App script");
  assert.doesNotThrow(() => new Script(html.slice(start, end)));
});

test("dashboard audio timing follows backend PREPARE T-10 and signal finalization T-5", () => {
  assert.match(dashboardJs, /latestPreAlertStatus\(\)==="PREPARE_ALERT"/);
  assert.match(dashboardJs, /remaining\s*>\s*5/);
  assert.match(dashboardJs, /remaining <= 5/);
  assert.ok(dashboardJs.includes('key+":5"'));
  assert.doesNotMatch(dashboardJs, /remaining <= 3/);
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /T-10 PREPARE alert/);
});

test("V1 PREPARE candidates cannot be promoted into final T-5 signals below 65", () => {
  assert.match(serverJs, /const finalSignal = \["CALL", "PUT"\]\.includes\(candidate\.signal\)/);
  assert.match(serverJs, /if \(!activeForCurrentOrNext && engineWindow && selectedFinalSignal && timingReady\)/);
  assert.doesNotMatch(serverJs, /finalizeWindow && candidateSignal &&/);
});

test("Engine 4 is exposed as an independent analyzer and participates in the four-engine system", () => {
  assert.match(serverJs, /engine4: engineResults\.ENGINE_4/);
  assert.match(serverJs, /ENGINE_4: \{ \.\.\.engine4Raw, provider: "LOCAL_AWESOME_OSCILLATOR_ENGINE_4"/);
  assert.match(serverJs, /const engineResults = \{\}/);
  assert.match(serverJs, /for \(const engine of ENGINE_KEYS\)/);
  assert.match(serverJs, /engineRecoveryStates\[engine\]/);
  assert.match(html, /function paintEngineCards/);
  assert.match(html, /const fourth=m\.engine4\|\|engines\.ENGINE_4\|\|\{\}/);
  assert.match(html, /id="engine4Card"/);
  assert.match(html, /id="engine4Signal"/);
  assert.match(html, /id="engine4Reason"/);
  assert.match(serverJs, /engine4Candidate/);
  assert.match(serverJs, /analyzeEarlyEntryEngine4\(analysisCandles, \{ liveCandle:livePreview \}\)/);
  assert.match(serverJs, /const engineWindow = finalizeWindow/);
  assert.match(serverJs, /canFinalizeSignal\(\{ candleEpoch: sourceCandleEpoch/);
  assert.match(serverJs, /engine4DecisionMode: "AWESOME_OSCILLATOR_5_34_STRONG_MOMENTUM_ATR_EXPANSION_T5_NEXT_M1"/);
  assert.doesNotMatch(serverJs, /engine4PendingForecast|NEXT_M1_ENTRY_READY/);
  assert.match(serverJs, /v1Candidate \|\| bbCandidate \|\| trendCandidate \|\| engine4Candidate/);
});

test("Engine 4 adaptive signal shares T-5 alert timing and 30-second hold", () => {
  assert.match(serverJs, /Boolean\(v1Candidate \|\| bbCandidate \|\| trendCandidate \|\| engine4Candidate\)/);
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /playSequence\(\[587,784\]/);
  assert.match(html, /navigator\.vibrate\(\[100,60,100\]\)/);
  assert.match(html, /const fourthActive=usable&&fourth\.active===true/);
  assert.match(html, /if\(fourthActive&&windowKey!==engine4LastFinalKey\)/);
  assert.match(html, /const fourth=m\.engine4\|\|engines\.ENGINE_4\|\|\{\}/);
  assert.match(html, /engine4HoldUntil=Date\.parse\(fourth\.signalExpiresAt\)\|\|Date\.now\(\)\+30000/);
  assert.match(html, /engine4HeldSignal&&Date\.now\(\)<engine4HoldUntil/);
  assert.match(html, /triggerSignalAlert\(item\.signal,alertKey,item\.engine\)/);
  assert.match(html, /playSequence\(isCall\?\[660,880,1175,880\]:\[880,660,440,660\]/);
  assert.match(html, /navigator\.vibrate\(isCall\?\[250,100,250,100,450\]:\[450,120,250,120,450\]/);
  assert.doesNotMatch(html, /triggerEngine4SoundAndVibration/);
});

test("four engine cards remain independently toggleable and Engine 4 uses Awesome Oscillator 5/34 only", () => {
  for (const id of ["v1Card", "bbCard", "trendCard", "engine4Card"]) {
    assert.match(html, new RegExp(`id="${id}" class="engine-card engine-enabled" role="button"`));
  }
  for (const key of ["V1", "BB", "TREND_RIDER", "ENGINE_4"]) {
    assert.match(html, new RegExp('data-light-toggle="' + key + '"'));
  }
  assert.match(html, /signalRadarEngineLightInverted/);
  assert.ok(html.includes("#engine4Card{--call-color:#39e879;--call-glow:#39e87988;--put-color:#ff535b;--put-glow:#ff535b88}"));
  assert.match(html, /#engine4Card\.light-inverted\{--call-color:#ff535b/);
  assert.match(html, /function toggleEngineLight/);
  assert.match(html, /function paintEngineLightSettings/);
  assert.match(html, /const mapping=key==="ENGINE_4"/);
  assert.match(html, /signalRadarEngineEnabled/);
  assert.match(html, /api\/telegram\/engines/);
  assert.match(html, /engineEnabled\.ENGINE_4/);
  assert.match(serverJs, /const engineEnabled = \{ V1: true, BB: true, TREND_RIDER: true, ENGINE_4: true \}/);
  assert.match(serverJs, /app\.post\("\/api\/telegram\/engines"/);
  assert.match(serverJs, /if \(!engineEnabled\[engine\]\)/);
  assert.match(serverJs, /strategy: "AWESOME_OSCILLATOR_5_34_STRONG_MOMENTUM_ATR_EXPANSION_T5_NEXT_M1"/);
  assert.match(serverJs, /formula: "SMA5\(MEDIAN_PRICE\)-SMA34\(MEDIAN_PRICE\)"/);
  assert.match(serverJs, /decisionRule: "AO_DIRECTION_ONLY_WHEN_SAME_SIDE_AND_EXPANDING_TWICE_AND_ABS_AO_AT_LEAST_0_12_ATR14"/);
  assert.match(serverJs, /otherIndicators: "ATR14_USED_ONLY_AS_NORMALIZER"/);
  assert.match(serverJs, /decisionWindow: "SOURCE_M1_T_MINUS_5; DISPATCH_WITH_ENGINES_1_TO_3"/);
  assert.match(serverJs, /target: "NEXT_M1_CANDLE"/);
  assert.match(serverJs, /signalHoldSeconds: 30/);
  assert.match(serverJs, /scoring: "DISABLED"/);
  assert.match(serverJs, /engine === "ENGINE_4" \? "TARGET_M1_CANDLE_OPEN"/);
  assert.doesNotMatch(serverJs, /MULTI_DIMENSION_ADAPTIVE|TREND_EMA8_21|BOLLINGER_RSI_REVERSAL/);
});

test("Engine 4 API result omits score and confidence fields", () => {
  assert.match(serverJs, /delete engineResult\.score/);
  assert.match(serverJs, /delete engineResult\.confidence/);
  assert.match(serverJs, /delete engineResult\.candidateScore/);
  assert.match(serverJs, /delete engineResult\.activeSignalScore/);
  assert.match(serverJs, /delete disabledResult\.score/);
  assert.match(serverJs, /delete disabledResult\.confidence/);
});

test("Streaming Tick re-analysis stays local while Engine 4 analyzes live M1 Awesome Oscillator", () => {
  assert.ok(configJs.includes("LIVE_ANALYSIS_INTERVAL_SECONDS = 0.25"));
  assert.match(configJs, /LIVE_PRICE_CHECK_SECONDS = 5/);
  assert.match(configJs, /REST_SYNC_SECONDS = 180/);
  assert.ok(serverJs.includes("LIVE_ANALYSIS_INTERVAL_SECONDS * 1000"));
  assert.ok(serverJs.includes("function scheduleLiveAnalysis(feed)"));
  assert.ok(serverJs.includes("scheduleLiveAnalysis(feed);"));
  assert.ok(serverJs.includes('liveAnalysisTrigger: "STREAMING_TICK_EVENT_PLUS_LOCAL_SAFETY_TIMER"'));
  assert.ok(serverJs.includes("REST_SYNC_SECONDS * 1000"));
  assert.match(serverJs, /restRefreshSeconds: REST_SYNC_SECONDS/);
  assert.match(serverJs, /liveAnalysisIntervalSeconds: LIVE_ANALYSIS_INTERVAL_SECONDS/);
  assert.match(serverJs, /analysisMode: engine === "ENGINE_4" \? \(selectedCandidate\.analysisMode \|\| "AO_STRONG_MOMENTUM"\)/);
  assert.match(serverJs, /analysisMode: livePreview \? "LIVE_M1_PREVIEW" : "CLOSED_M1_ONLY"/);
  assert.doesNotMatch(serverJs, /THREE_CLOSED_M1_PLUS_LIVE_TICK_ACCUMULATED_PRESSURE_T10_T5/);
  assert.match(html, /if\(lightButton\)lightButton\.addEventListener/);
  assert.match(html, /data-light-toggle="ENGINE_4"/);
});


test("Engine 4 card has no momentum percentage or gauge UI", () => {
  assert.doesNotMatch(html, /engine4Momentum|engine-momentum|momentumPercent|แรงส่ง AO/);
});

test("Mini App does not show a recovery badge and health reports recovery disabled", () => { assert.doesNotMatch(html, /tag\.textContent="กำลังแก้มือ"/); assert.doesNotMatch(html, /const recovering=/); assert.match(serverJs, /enabled: false, mode: "DISABLED"/); assert.match(serverJs, /altersMiniApp: false/); });
