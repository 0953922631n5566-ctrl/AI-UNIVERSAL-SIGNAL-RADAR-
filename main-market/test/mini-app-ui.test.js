import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const serverJs = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Mini App includes all six selectable currency pairs and ten API slots", () => {
  for (const symbol of ["AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]) {
    assert.match(html, new RegExp(symbol.replace("/", "\\/")));
  }
  assert.match(html, /TWELVE DATA API KEYS · 01–10/);
  assert.match(html, /apiKeys/);
});

test("Mini App preserves PREPARE T-10, CALL/PUT T-5, sound, vibration, and 30-second hold", () => {
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
  assert.ok(html.includes("ACCURACY LAB TREND ONLY"));
  assert.ok(html.includes("HH/HL = CALL"));
  assert.ok(html.includes("LH/LL = PUT"));
  assert.ok(html.includes("NO TRADE"));
  assert.match(html, /m\.score/);
  assert.match(html, /m\.metrics\?\.sidewayScore/);
  assert.match(html, /id="reversal"/);
  assert.doesNotMatch(html, /PARTIAL SCORING 65\/45|m\.scores\?\.CALL|geminiQuota/);
});

test("Mini App presents Accuracy Lab diagnostics instead of the former weighted score display", () => {
  assert.ok(html.includes("ACCURACY LAB · TREND ONLY SIGNAL ENGINE"));
  assert.match(html, /ACCURACY LAB SETUP/);
  assert.match(html, /m\.entryType/);
  assert.match(html, /m\.metrics\?\.adxProxy/);
  assert.match(html, /m\.marketIntelligence/);
  assert.doesNotMatch(html, /PARTIAL SCORING 65\/45|SCORING BREAKDOWN/);
});

test("server uses Accuracy Lab as the only directional analyzer and retains source/timing guards", () => {
  assert.match(serverJs, /import \{ sourceGate \} from "\.\/src\/analyzer\.js"/);
  assert.match(serverJs, /import \{ analyzeMarketIntelligence \} from "\.\/src\/accuracy-lab\/market-intelligence\.js"/);
  assert.match(serverJs, /const setup = gate\.ready \? lab\.setup : null/);
  assert.match(serverJs, /const direction = setup\?\.direction/);
  assert.match(serverJs, /isPrepareAlertWindow/);
  assert.match(serverJs, /isSignalFinalizeWindow/);
  assert.match(serverJs, /signalHoldExpiresAt/);
  assert.doesNotMatch(serverJs, /import \{ analyzeMarket \}/);
  assert.doesNotMatch(serverJs, /await analyzeMarket\(/);
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
