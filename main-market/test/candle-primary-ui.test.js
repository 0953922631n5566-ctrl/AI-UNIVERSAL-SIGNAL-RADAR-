import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../public/candle-lab.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Telegram primary /signal route serves the 200K historical candle analyzer", () => {
  assert.match(server, /app\.get\("\/signal".*public.*candle-lab\.html/s);
  assert.match(server, /primaryMiniApp: \{ route: "\/signal"/);
  assert.match(server, /defaultHistoryCandles: 200000/);
});

test("primary Mini App automatically starts 200K Twelve Data history learning", () => {
  assert.match(html, /targetCandles:200000/);
  assert.match(html, /if\(lastPhase==="NOT_STARTED"\)await startTraining\(\)/);
  assert.match(html, /เริ่มเรียนรู้ข้อมูลย้อนหลัง 200,000 แท่ง/);
  assert.match(html, /Twelve Data/);
});

test("primary Mini App displays current price, API pool and learning progress", () => {
  for (const id of ["price", "priceAge", "api", "pool", "learnStatus", "bar", "candles", "signal", "matches", "call", "put"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(server, /market: snapshot\(\), apiPool: twelveDataKeyPool\.publicStatus\(\)/);
});

test("historical direction is blocked unless current Streaming price is fresh", () => {
  assert.match(server, /tickAgeSeconds > MAX_STREAM_AGE_SECONDS/);
  assert.match(server, /ราคา Streaming ไม่สดพอ/);
  assert.match(server, /livePriceRequired: true/);
});

test("primary Mini App embedded JavaScript parses", () => {
  const start = html.lastIndexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start, end)));
});
