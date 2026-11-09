import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");

test("Mini App includes all six selectable currency pairs and ten API slots", () => {
  for (const symbol of ["AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]) {
    assert.match(html, new RegExp(symbol.replace("/", "\\/")));
  }
  assert.match(html, /TWELVE DATA API KEYS · 01–10/);
  assert.match(html, /apiKeys/);
});

test("Mini App provides distinct ten-second and real-signal audio/visual alerts", () => {
  assert.match(html, /id="soundEnable"/);
  assert.match(html, /function triggerPreAlert/);
  assert.match(html, /remainingMs<=10000/);
  assert.match(html, /function triggerSignalAlert/);
  assert.match(html, /m\.alertId/);
  assert.match(html, /alert-flash-call/);
  assert.match(html, /alert-flash-put/);
  assert.match(html, /ไม่ใช่สัญญาณ CALL\/PUT/);
});

test("Mini App requires signed Telegram WebApp initData and never creates a guest session", () => {
  assert.match(html, /tg\\.initData/);
  assert.match(html, /TELEGRAM VERIFIED/);
  assert.match(html, /กรุณาเปิดหน้านี้จากปุ่มเมนูของบอต Telegram/);
  assert.doesNotMatch(html, /SESSION READY/);
});

test("Mini App inline JavaScript parses successfully", () => {
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start, "expected an inline Mini App script");
  assert.doesNotThrow(() => new Script(html.slice(start, end)));
});
