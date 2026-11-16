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
  assert.ok(html.includes("V1 + BB PURE SCALPER"));
  assert.match(html, /EMA5/);
  assert.match(html, /id="reversal"/);
  assert.match(html, /m\.scores\?\.CALL/);
  assert.match(html, /m\.engineResults/);
  assert.match(html, /m\.activeSignals/);
  assert.match(html, /id="v1Card"/);
  assert.match(html, /id="bbCard"/);
  assert.match(html, /id="trendCard"/);
  assert.match(html, /id="trendSignal"/);
  assert.match(html, /BB\(20,2\)/);
  assert.match(html, /SCORING BREAKDOWN/);
  assert.doesNotMatch(html, /EMA 3\/8\/50|geminiQuota/);
});

test("Mini App identifies Partial Scoring and exposes weighted score breakdown", () => {
  assert.ok(html.includes("V1 + BB PURE SCALPER"));
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
