import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const serverJs = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Mini App is restricted to EUR/USD and keeps API details inside a collapsible menu", () => {
  assert.match(html, /EUR \/ USD/);
  assert.match(html, /EUR \/ USD/);
  for (const symbol of ["AUD/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]) {
    assert.doesNotMatch(html, new RegExp(symbol.replace("/", "\\/")));
  }
  assert.match(html, /<details class="api-drawer">/);
  assert.match(html, /apiKeys/);
});

test("Mini App shows score-aware PREPARE at T-10 and CALL/PUT at T-5 for 30 seconds into the next candle", () => {
  assert.match(html, /id="soundEnable"/);
  assert.match(html, /PREPARE \/ เฝ้าระวัง/);
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /m\.alertId/);
  assert.match(html, /function triggerSignalAlert/);
  assert.match(html, /signalExpiresAt/);
  assert.match(html, /holdMs/);
  assert.match(html, /alert-flash-call/);
  assert.match(html, /alert-flash-put/);
  assert.match(html, /T-5/);
  assert.ok(html.includes("V1 + BB + TREND RIDER AI"));
  assert.match(html, /EMA5/);
  assert.match(html, /id="reversal"/);
  assert.match(html, /m\.scores\?\.CALL/);
  assert.match(html, /m\.engineResults/);
  assert.match(html, /m\.activeSignals/);
  assert.match(html, /id="v1Card"/);
  assert.match(html, /id="bbCard"/);
  assert.match(html, /id="trendCard"/);
  assert.match(html, /id="trendSignal"/);
  assert.match(html, /id="engine4Card"/);
  assert.match(html, /id="engine4Signal"/);
  assert.match(html, /id="engine4Reason"/);
  assert.match(html, /const fourth=m\.engine4\|\|\{\}/);
  assert.match(html, /#engine4Card\.call\{border-color:#25885d\}/);
  assert.match(html, /#engine4Card\.call \.engine-value\{color:#5df0a4\}/);
  assert.match(html, /#engine4Card\.put\{border-color:#9c4355\}/);
  assert.match(html, /#engine4Card\.put \.engine-value\{color:#ff7d91\}/);
  assert.match(html, /#trendCard\.call\{border-color:#9c4355\}/);
  assert.match(html, /#trendCard\.call \.engine-value\{color:#ff7d91\}/);
  assert.match(html, /#trendCard\.put\{border-color:#25885d\}/);
  assert.match(html, /#trendCard\.put \.engine-value\{color:#5df0a4\}/);
  assert.match(html, /#v1Card\.call\{border-color:#25885d\}/);
  assert.match(html, /#v1Card\.call \.engine-value\{color:#5df0a4\}/);
  assert.match(html, /#v1Card\.put\{border-color:#9c4355\}/);
  assert.match(html, /#v1Card\.put \.engine-value\{color:#ff7d91\}/);
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
  assert.match(serverJs, /finalizeWindow && finalSignal &&/);
  assert.doesNotMatch(serverJs, /finalizeWindow && candidateSignal &&/);
});

test("Engine 4 is displayed separately and does not enter the existing alert/sound pipeline", () => {
  assert.match(serverJs, /engine4: engine4Result/);
  assert.match(serverJs, /analyzeStrictTrendRider\(closedCandles\)/);
  assert.match(serverJs, /engine4SourceReady = closedCandles\.length >= 35/);
  assert.match(serverJs, /engines: 4/);
  assert.match(html, /function paintEngineCards/);
  assert.match(html, /const fourth=m\.engine4\|\|\{\}/);
  assert.doesNotMatch(serverJs.slice(serverJs.indexOf("const activeSignals ="), serverJs.indexOf("const activeDirections")), /ENGINE_4/);
});


test("Engine 4 follows shared T-10/T-5 timing, holds 30 seconds, and flashes only its own card without sound or vibration", () => {
  assert.match(html, /engine4Prepare=fourthReady&&remainingSeconds>5&&remainingSeconds<=10/);
  assert.match(html, /engine4Finalize=fourthReady&&remainingSeconds>0&&remainingSeconds<=5/);
  assert.match(html, /engine4HoldUntil=Date\.now\(\)\+30000/);
  assert.match(html, /#engine4Card\.engine4-flash-call/);
  assert.match(html, /#engine4Card\.engine4-flash-put/);
  assert.match(html, /engine4BorderFlashCall/);
  assert.match(html, /engine4BorderFlashPut/);
  const start = html.indexOf("const fourth=m.engine4||{}");
  const end = html.indexOf("\n}\nfunction paint(m)", start);
  assert.ok(start >= 0 && end > start, "expected isolated Engine 4 card renderer");
  const engine4Ui = html.slice(start, end);
  assert.doesNotMatch(engine4Ui, /playSequence|navigator\.vibrate|HapticFeedback|triggerSignalAlert/);
});


test("four engine cards are independently toggleable and Engine 4 has no cross-card alert pipeline", () => {
  for (const id of ["v1Card", "bbCard", "trendCard", "engine4Card"]) {
    assert.match(html, new RegExp(`id="${id}" class="engine-card engine-enabled" role="button"`));
  }
  assert.match(html, /signalRadarEngineEnabled/);
  assert.match(html, /api\/telegram\/engines/);
  assert.match(html, /engineEnabled\.ENGINE_4/);
  assert.match(serverJs, /const engineEnabled = \{ V1: true, BB: true, TREND_RIDER: true, ENGINE_4: true \}/);
  assert.match(serverJs, /app\.post\("\/api\/telegram\/engines"/);
  assert.match(serverJs, /if \(!engineEnabled\[engine\]\)/);
  assert.match(serverJs, /minimumSignalScore: 75/);\n  assert.match(serverJs, /copiedFrom: "TREND_RIDER_AI"/);
});
