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
  assert.match(html, /TWELVE DATA · API POOL/);
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
  assert.ok(html.includes("PRECISION ENTRY"));
  assert.match(html, /m\.precisionEntry/);
  assert.match(html, /m\.score/);
  assert.match(html, /PRECISION ENTRY · /);
  assert.match(html, /id="reversal"/);
  assert.doesNotMatch(html, /geminiQuota/);
});

test("Mini App retains Precision Entry score diagnostics without occupying the compact signal screen", () => {
  assert.ok(html.includes("TELEGRAM MINI APP · MAIN MARKET · NON-OTC · M1"));
  assert.match(html, /class="diagnostics" aria-hidden="true"/);
  assert.match(html, /m\.precisionEntry/);
  assert.match(html, /pe\.scores/);
  assert.match(html, /ENTRY ≥80 \/ GAP ≥12/);
  assert.doesNotMatch(html, /REVERSAL RADAR|ORIGINAL 84 · PARTIAL SCORING SIGNAL ENGINE/);
});

test("server uses M1 Precision Entry as the only directional analyzer and retains source/timing guards", () => {
  assert.match(serverJs, /import \{ analyzeMarket \} from "\.\/src\/analyzer\.js"/);
  assert.doesNotMatch(serverJs, /analyzeMarketIntelligence/);
  assert.match(serverJs, /await analyzeMarket\(feed\.candles/);
  assert.match(serverJs, /const direction = rawResult\.direction/);
  assert.match(serverJs, /isPrepareAlertWindow/);
  assert.match(serverJs, /isSignalFinalizeWindow/);
  assert.match(serverJs, /signalHoldExpiresAt/);
  assert.match(serverJs, /M1 Precision Entry is the sole directional analyzer/);
  assert.doesNotMatch(serverJs, /analyzeMarketIntelligence/);
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
  assert.match(html, /playSequence\(\[587\],0\.22,0\.08\)/, "T-10 warning is one single beep");
  assert.match(html, /playSequence\(isCall\?\[660,784,880,1047,1175,1047,1319,1175\]/, "CALL/PUT alert uses a rapid multi-tone sequence");
  assert.match(html, /button\.setAttribute\("aria-pressed","true"\)/);
  assert.doesNotMatch(html, /soundStatus/);
  assert.match(html, /T-10 PREPARE alert/);
});


test("Mini App top-right status shows pulsing API LIVE only when online and red disconnected otherwise", () => {
  assert.match(html, /id="api" class="pill off"[^>]*>API DISCONNECTED/);
  assert.match(html, /\.pill\.live\{[^}]*animation:apiPulse/);
  assert.match(html, /apiConnected\?"live":"off"/);
  assert.match(html, /apiConnected\?"API LIVE":"API DISCONNECTED"/);
  assert.match(html, /api==="ONLINE"&&\(!Number\.isFinite\(tickAge\)\|\|tickAge<=15\)/);
  assert.doesNotMatch(html, /STREAM LIVE|SESSION READY|CONNECTING/);
});


test("Mini App fits compact floating windows without vertical scrolling and emphasizes a large signal lamp", () => {
  assert.match(html, /height:100%;max-height:100%/);
  assert.match(html, /overflow:hidden/);
  assert.match(html, /grid-template-rows:auto auto minmax\(145px,1fr\)/);
  assert.match(html, /\.lamp\{width:clamp\(100px,30vw,158px\);height:clamp\(100px,30vw,158px\)/);
  assert.match(html, /@media\(max-height:590px\)/);
  assert.match(html, /id="signal" class="value"/);
  assert.match(html, /id="apiKeys" class="api-grid"/);
  assert.match(html, /id="soundEnable"/);
});
