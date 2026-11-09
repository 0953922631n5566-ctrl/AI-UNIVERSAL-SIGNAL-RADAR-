import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("Mini App includes all six selectable currency pairs and ten API slots", () => {
  for (const symbol of ["AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]) {
    assert.match(html, new RegExp(symbol.replace("/", "\\/")));
  }
  assert.match(html, /TWELVE DATA API KEYS · 01–10/);
  assert.match(html, /apiKeys/);
});

test("Mini App shows non-directional PREPARE at T-10 and CALL/PUT at T-5 for 30 seconds into the next candle", () => {
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
  assert.match(html, /GEMINI PRIMARY ANALYZER/);
  assert.match(html, /Gemini เป็นผู้วิเคราะห์หลักเพียงตัวเดียว/);
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
  assert.match(dashboardJs, /key+":5"/);
  assert.doesNotMatch(dashboardJs, /remaining <= 3/);
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /T-10 PREPARE alert/);
});
