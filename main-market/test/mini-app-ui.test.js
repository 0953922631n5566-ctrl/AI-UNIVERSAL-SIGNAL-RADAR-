import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/signal.html", import.meta.url), "utf8");
const serverJs = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Mini App shows only the two requested independent engine cards", () => {
  assert.match(html, /ENGINE 02 · BB PURE SCALPER/);
  assert.match(html, /ENGINE 03 · TREND RIDER/);
  assert.match(html, /id="engineBB"/);
  assert.match(html, /id="engineTrend"/);
  for (const id of ["v1Card", "engine4Card", "v1Signal", "engine4Signal", "panel"]) {
    assert.doesNotMatch(html, new RegExp('id="' + id + '"'));
  }
  assert.match(serverJs, /const engineEnabled = \{ V1: false, BB: true, TREND_RIDER: true, ENGINE_4: false \}/);
  assert.match(serverJs, /engines: 2/);
});

test("CALL is green and PUT is red independently on both engine cards", () => {
  assert.match(html, /\.engine-card\.call\{border-color:#1cba70/);
  assert.match(html, /\.engine-card\.call \.signal-lamp\{background:var\(--green\)/);
  assert.match(html, /\.engine-card\.call \.signal-value\{color:var\(--green\)/);
  assert.match(html, /\.engine-card\.put\{border-color:#e04c5e/);
  assert.match(html, /\.engine-card\.put \.signal-lamp\{background:var\(--red\)/);
  assert.match(html, /\.engine-card\.put \.signal-value\{color:var\(--red\)/);
  assert.match(html, /paintEngine\("BB",engines\.BB/);
  assert.match(html, /paintEngine\("TREND_RIDER",engines\.TREND_RIDER/);
  assert.match(html, /filter\(x=>\["BB","TREND_RIDER"\]\.includes\(x\.engine\)/);
  assert.doesNotMatch(html, /const direction=usable/);
});

test("Secondary information is hidden until the menu is opened", () => {
  assert.match(html, /id="menuButton"/);
  assert.match(html, /id="menuPanel" hidden/);
  assert.match(html, /function openMenu\(open\)/);
  assert.match(html, /addEventListener\("click",\(\)=>openMenu\(\$\("menuPanel"\)\.hidden\)\)/);
  for (const id of ["price", "age", "candle", "candles", "regime", "bbDetail", "trendDetail", "apiKeys", "soundEnable"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /function paintApiPool/);
});

test("Sound, vibration, per-engine alerts and 30-second hold are retained", () => {
  assert.match(html, /id="soundEnable"/);
  assert.match(html, /function enableSound\(\)/);
  assert.match(html, /navigator\.vibrate\(call\?\[250,100,250,100,450\]:\[450,120,250,120,450\]\)/);
  assert.match(html, /notificationOccurred\(call\?"success":"error"\)/);
  assert.match(html, /signalExpiresAt/);
  assert.match(html, /แสดง 30 วินาที/);
  assert.match(html, /function signalAlert\(item,symbol\)/);
  assert.match(html, /playSequence\(call\?\[660,880,1175,880\]:\[880,660,440,660\]/);
});

test("T-10 PREPARE sound and haptic cue remains available", () => {
  assert.match(html, /m\.preAlertStatus==="PREPARE_ALERT"/);
  assert.match(html, /playSequence\(\[587,784\]/);
  assert.match(html, /navigator\.vibrate\?\.\(\[100,60,100\]\)/);
  assert.match(html, /lastPrepareKey/);
});

test("Only BB and Trend Rider can be enabled from the Mini App", () => {
  assert.match(html, /engineEnabled=\{V1:false,BB:true,TREND_RIDER:true,ENGINE_4:false\}/);
  assert.match(html, /body:JSON\.stringify\(\{engines:engineEnabled\}\)/);
  assert.match(html, /\$\("bbEnabled"\)/);
  assert.match(html, /\$\("trendEnabled"\)/);
  assert.match(serverJs, /app\.post\("\/api\/telegram\/engines"/);
  assert.match(serverJs, /if \(!engineEnabled\[engine\]\)/);
});

test("Mini App is fixed to EUR/USD M1 and keeps manual-only execution", () => {
  assert.match(html, /EUR\/USD · NON-OTC · M1/);
  assert.match(html, /MANUAL ONLY · NO BROKER EXECUTION/);
  assert.doesNotMatch(html, /AUD\/USD|EUR\/GBP|GBP\/JPY|EUR\/JPY|GBP\/USD/);
  assert.doesNotMatch(html, /broker\.buy|broker\.sell|placeOrder/);
});

test("Mini App script only references DOM elements that exist", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const references = [...html.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);
  const missing = [...new Set(references.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test("Mini App inline JavaScript parses successfully", () => {
  const start = html.indexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start, "expected an inline Mini App script");
  assert.doesNotThrow(() => new Script(html.slice(start, end)));
});

test("Backend exposes per-engine results while disabling removed engines by default", () => {
  assert.match(serverJs, /engineResults,/);
  assert.match(serverJs, /activeSignals/);
  assert.match(serverJs, /engineEnabled = \{ V1: false, BB: true, TREND_RIDER: true, ENGINE_4: false \}/);
  assert.match(serverJs, /BB_AND_TREND_RIDER_INDEPENDENT_SIGNALS_ONLY/);
  assert.match(serverJs, /signalHoldSeconds: 30/);
});
