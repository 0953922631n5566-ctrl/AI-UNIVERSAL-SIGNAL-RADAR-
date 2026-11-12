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
  assert.ok(html.includes("ORIGINAL 84"));
  assert.ok(html.includes("EMA5 SLOPE/REVERSAL"));
  assert.ok(html.includes("S/R FAKEOUT"));
  assert.ok(html.includes("PARTIAL SCORING 60/40"));
  assert.match(html, /m\.score/);
  assert.match(html, /ORIGINAL 84 · /);
  assert.match(html, /id="reversal"/);
  assert.doesNotMatch(html, /geminiQuota/);
});

test("Mini App presents ORIGINAL 84 weighted scoring diagnostics", () => {
  assert.ok(html.includes("M1 PRECISION ENTRY · MAIN MARKET · NON-OTC"));
  assert.match(html, /m\.precisionEntry/);
  assert.match(html, /pe\.scores/);
  assert.match(html, /ENTRY ≥80 \/ GAP ≥12/);
  assert.match(html, /STRUCT .*\/25 · PRICE .*\/25 · MOM .*\/20 · TREND .*\/15 · SAFETY .*\/15/);
  assert.doesNotMatch(html, /REVERSAL RADAR|ORIGINAL 84 · PARTIAL SCORING SIGNAL ENGINE/);
});

test("server uses ORIGINAL 84 as the only directional analyzer and retains source/timing guards", () => {
  assert.match(serverJs, /import \{ analyzeMarket \} from "\.\/src\/analyzer\.js"/);
  assert.doesNotMatch(serverJs, /analyzeMarketIntelligence/);
  assert.match(serverJs, /await analyzeMarket\(feed\.candles/);
  assert.match(serverJs, /const direction = rawResult\.direction/);
  assert.match(serverJs, /isPrepareAlertWindow/);
  assert.match(serverJs, /isSignalFinalizeWindow/);
  assert.match(serverJs, /signalHoldExpiresAt/);
  assert.match(serverJs, /ORIGINAL 84 is the sole directional analyzer/);
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
  assert.match(html, /T-10 PREPARE alert/);
});
