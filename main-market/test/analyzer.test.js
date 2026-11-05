import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import {
  MIN_CLOSED_CANDLES, HISTORY_CANDLES, DIRECTIONAL_THRESHOLD,
  ANALOGUE_PATTERN_CANDLES, ANALOGUE_TOP_K, ANALOGUE_MIN_MATCHES
} from "../src/config.js";
import { analyzeMarket } from "../src/analyzer.js";
import { simulateHistoricalAnalogues } from "../src/historical-analogue.js";

function history(count = 80) {
  let price = 1.08;
  const start = Math.floor(Date.now() / 60000) * 60 - count * 60;
  return Array.from({ length: count }, (_, i) => {
    const delta = Math.sin(i * 1.7) * 0.00005 + Math.sin(i * 0.37) * 0.000025;
    const open = price, close = price + delta, epoch = start + i * 60;
    price = close;
    return { time: new Date(epoch * 1000).toISOString(), epoch, open,
      high: Math.max(open, close) + 0.000015, low: Math.min(open, close) - 0.000015,
      close, live: false };
  });
}

test("Main Market config and analogue parameters", () => {
  assert.equal(MIN_CLOSED_CANDLES, 60);
  assert.equal(HISTORY_CANDLES, 80);
  assert.equal(DIRECTIONAL_THRESHOLD, 53);
  assert.equal(ANALOGUE_PATTERN_CANDLES, 8);
  assert.equal(ANALOGUE_TOP_K, 20);
  assert.equal(ANALOGUE_MIN_MATCHES, 12);
});

test("Historical Analogue Simulation is the only analyzer decision path", () => {
  const candles = history(), now = Date.now();
  assert.deepEqual(
    analyzeMarket(candles, { now, tickAgeSeconds: 0 }),
    simulateHistoricalAnalogues(candles, { now, tickAgeSeconds: 0 })
  );
});

test("53% is an analogue directional share, not a calibrated win probability", () => {
  const result = analyzeMarket(history(), { tickAgeSeconds: 0 });
  if (result.signal === "CALL") assert.ok(result.metrics.upwardPercent >= 53);
  if (result.signal === "PUT") assert.ok(result.metrics.downwardPercent >= 53);
  assert.equal("confidence" in result, false);
  if (result.evidence.length) assert.ok(result.evidence.some(x => x.includes("ไม่ใช่ win probability")));
});

test("minimum closed history, malformed OHLC, duplicate time and stale candles fail closed", () => {
  assert.match(analyzeMarket(history(59), { tickAgeSeconds: 0 }).reason, /59\/60/);
  let candles = history();
  candles.at(-1).high = candles.at(-1).low - 0.1;
  assert.match(analyzeMarket(candles, { tickAgeSeconds: 0 }).reason, /OHLC/);
  candles = history();
  candles.at(-1).epoch = candles.at(-2).epoch;
  assert.match(analyzeMarket(candles, { tickAgeSeconds: 0 }).reason, /ซ้ำ|เรียง/);
  candles = history();
  candles.forEach(c => { c.epoch -= 600; });
  assert.match(analyzeMarket(candles, { tickAgeSeconds: 0 }).reason, /เก่า/);
});

test("fresh source required and current live candle excluded", () => {
  const candles = history();
  candles.push({ ...candles.at(-1), epoch: Math.floor(Date.now() / 60000) * 60, live: true });
  assert.equal(analyzeMarket(candles, { tickAgeSeconds: 0 }).closedCandleCount, 80);
  assert.equal(analyzeMarket(history(), { tickAgeSeconds: null }).signal, "STANDBY");
});

test("legacy indicator functions and EMA21 signal invalidation are absent", async () => {
  const analyzer = await readFile(new URL("../src/analyzer.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.doesNotMatch(analyzer, /EMA|RSI|MACD|momentum|bullishScore|bearishScore/);
  assert.doesNotMatch(server, /ema21|EMA21|TRENDING_DOWN|TRENDING_UP/);
  assert.match(analyzer, /simulateHistoricalAnalogues/);
});

test("HTTP health and Mini App smoke test", async () => {
  const port = 32189;
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), TWELVE_DATA_API_KEY: "", TELEGRAM_BOT_TOKEN: "test_bot_token" },
    stdio: "ignore"
  });
  try {
    let response;
    for (let i = 0; i < 60; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) break; } catch {}
      await delay(100);
    }
    assert.ok(response?.ok, "server did not become ready");
    const health = await response.json();
    assert.equal(health.service, "main-market");
    assert.equal(health.interval, "1min");
    assert.equal(health.configuration.minimumClosedCandles, 60);
    assert.equal(health.configuration.historyCandles, 80);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /UNIVERSAL RADAR/);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(1500)]);
  }
}, { timeout: 15000 });
