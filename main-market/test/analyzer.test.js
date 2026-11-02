import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  SYMBOLS, DEFAULT_SYMBOL, MIN_CLOSED_CANDLES, HISTORY_CANDLES,
  REST_SYNC_SECONDS, resolveSymbol
} from "../src/config.js";
import { analyzeMarket, ema, rsi } from "../src/analyzer.js";
import { fetchCandles } from "../src/twelve-data.js";
import { createHmac } from "node:crypto";
import { validateTelegramInitData } from "../src/telegram-auth.js";

const TEST_BOT_TOKEN = "123456789:test_bot_token_for_unit_tests";
function signedInitData({ authDate = Math.floor(Date.now() / 1000), userId = 424242 } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAE-test-query",
    user: JSON.stringify({ id: userId, first_name: "Test" })
  });
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TEST_BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("Telegram initData validation accepts authentic data and rejects tampering, expiry and future dates", () => {
  const now = Date.now();
  const valid = signedInitData({ authDate: Math.floor(now / 1000) });
  assert.equal(validateTelegramInitData(valid, TEST_BOT_TOKEN, now).ok, true);
  assert.equal(validateTelegramInitData(valid, TEST_BOT_TOKEN, now).userId, 424242);
  assert.equal(validateTelegramInitData(valid.replace("Test", "Evil"), TEST_BOT_TOKEN, now).ok, false);
  assert.equal(validateTelegramInitData(signedInitData({ authDate: Math.floor(now / 1000) - 90000 }), TEST_BOT_TOKEN, now).ok, false);
  assert.equal(validateTelegramInitData(signedInitData({ authDate: Math.floor(now / 1000) + 120 }), TEST_BOT_TOKEN, now).ok, false);
  assert.equal(validateTelegramInitData(valid, "", now).ok, false);
});

function makeCandles(count = 220, {
  start = Math.floor(Date.now() / 60000) * 60 - count * 60,
  step = 0.00001
} = {}) {
  return Array.from({ length: count }, (_, index) => {
    const close = 1.08 + index * step;
    const epoch = start + index * 60;
    return {
      time: new Date(epoch * 1000).toISOString().slice(0, 16).replace("T", " "),
      epoch,
      open: close - step / 3,
      high: close + step,
      low: close - step,
      close,
      live: false
    };
  });
}

test("the selector exposes exactly six pairs and scans one default pair", () => {
  assert.deepEqual(SYMBOLS, [
    "AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"
  ]);
  assert.equal(DEFAULT_SYMBOL, "EUR/USD");
  assert.equal(resolveSymbol(" eur / usd "), "EUR/USD");
  assert.equal(resolveSymbol("BTC/USD"), null);
  assert.equal(new Set(SYMBOLS).size, 6);
  assert.equal(MIN_CLOSED_CANDLES, 60);
  assert.equal(HISTORY_CANDLES, 80);
  assert.equal(REST_SYNC_SECONDS, 300);
});

test("server and REST client use the same reduced warmup limits", async () => {
  assert.ok(HISTORY_CANDLES >= MIN_CLOSED_CANDLES);
  assert.ok(HISTORY_CANDLES <= 100);
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.ok(server.includes("requiredCandles: MIN_CLOSED_CANDLES"));
});

test("EMA and RSI return stable numeric values and reject insufficient input", () => {
  assert.equal(ema([1, 2], 3), null);
  assert.equal(ema([1, 2, 3], 3), 2);
  const value = rsi(Array.from({ length: 30 }, (_, i) => 1 + i * 0.01));
  assert.ok(value >= 0 && value <= 100);
  assert.equal(rsi([1, 2, 3], 14), null);
});

test("REST history can provide indicators but cannot produce direction without a fresh live tick", () => {
  const history = makeCandles(220);
  const result = analyzeMarket(history, { tickAgeSeconds: null });
  assert.equal(result.signal, "STANDBY");
  assert.ok(result.metrics);
  assert.ok(Number.isFinite(result.lastPrice));
  assert.ok(Number.isFinite(result.metrics.rsi14));
  assert.equal(result.livePriceReady, false);
  assert.match(result.reason, /Streaming สด/);
  assert.equal("confidence" in result, false);
});

test("60 closed candles are enough to calculate the full indicator set", () => {
  const result = analyzeMarket(makeCandles(60), { tickAgeSeconds: null });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.requiredCandles, 60);
  assert.equal(result.closedCandleCount, 60);
  assert.equal(result.candleCount, 60);
  assert.ok(Number.isFinite(result.metrics.ema50));
  assert.ok(Number.isFinite(result.metrics.rsi14));
  assert.ok(Number.isFinite(result.metrics.macdHistogram));
  assert.ok(Number.isFinite(result.metrics.atr14));
});

test("the analyzer uses all 80 fetched bars when available", () => {
  const result = analyzeMarket(makeCandles(80), { tickAgeSeconds: null });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.requiredCandles, 60);
  assert.equal(result.closedCandleCount, 80);
  assert.equal(result.candleCount, 80);
  assert.ok(Number.isFinite(result.metrics.ema50));
});

test("59 closed candles remain insufficient", () => {
  const result = analyzeMarket(makeCandles(59), { tickAgeSeconds: null });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.requiredCandles, 60);
  assert.equal(result.closedCandleCount, 59);
  assert.match(result.reason, /59\/60/);
});

test("a live candle cannot be counted as one of the 60 required closed candles", () => {
  const history = makeCandles(59);
  const currentEpoch = Math.floor(Date.now() / 60000) * 60;
  history.push({
    time: "live", epoch: currentEpoch, open: 1.08,
    high: 1.081, low: 1.079, close: 1.0805, live: true
  });
  const result = analyzeMarket(history, { tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.closedCandleCount, 59);
  assert.equal(result.requiredCandles, 60);
});

test("malformed OHLC values fail closed", () => {
  const history = makeCandles(220);
  history.at(-1).high = history.at(-1).low - 0.01;
  const result = analyzeMarket(history, { tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /OHLC/);
});

test("duplicate or reversed candle timestamps fail closed", () => {
  const history = makeCandles(220);
  history.at(-1).epoch = history.at(-2).epoch;
  const result = analyzeMarket(history, { tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /ซ้ำ|ลำดับ/);
});

test("recent missing M1 bars fail closed, while older market-closure gaps are tolerated", () => {
  const oldGap = makeCandles(220);
  for (let i = 0; i < 30; i++) oldGap[i].epoch -= 3600;
  assert.ok(analyzeMarket(oldGap, { tickAgeSeconds: null }).metrics);

  const recentGap = makeCandles(220);
  recentGap.splice(-3, 1);
  const result = analyzeMarket(recentGap, { tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /ช่องว่าง/);
});

test("stale history fails closed", () => {
  const history = makeCandles(220);
  history.forEach(candle => { candle.epoch -= 600; });
  const result = analyzeMarket(history, { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /เก่า/);
});

test("directional decisions are limited to CALL, PUT or STANDBY and never invent confidence", () => {
  const result = analyzeMarket(makeCandles(220), { tickAgeSeconds: 0 });
  assert.ok(["CALL", "PUT", "STANDBY"].includes(result.signal));
  assert.ok(result.regime);
  assert.ok(Array.isArray(result.evidence));
  assert.equal("confidence" in result, false);
});

test("Twelve Data REST parsing sorts bars, removes current candle and validates OHLC", async () => {
  const now = Date.now();
  const bars = makeCandles(220, { start: Math.floor(now / 60000) * 60 - 220 * 60 });
  const values = bars.slice().reverse().map(c => ({
    datetime: c.time, open: String(c.open), high: String(c.high),
    low: String(c.low), close: String(c.close)
  }));
  values.push({
    datetime: new Date(Math.floor(now / 60000) * 60000).toISOString().slice(0, 16).replace("T", " "),
    open: "1.1", high: "1.2", low: "1.0", close: "1.1"
  });
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ meta: { symbol: "EUR/USD" }, values })
  });
  const result = await fetchCandles({
    apiKey: "test-key", symbol: "EUR/USD", fetchImpl: fakeFetch, now
  });
  assert.equal(result.candles.length, 80);
  assert.ok(result.candles[0].epoch < result.candles.at(-1).epoch);
  assert.ok(result.candles.every(c => c.live === false));
});

test("Twelve Data rejects unsupported symbols and classifies provider errors", async () => {
  await assert.rejects(
    fetchCandles({ apiKey: "test-key", symbol: "BTC/USD" }),
    /not enabled/
  );
  const fakeFetch = async () => ({
    ok: false, status: 429,
    json: async () => ({ status: "error", message: "API credits exhausted" })
  });
  await assert.rejects(
    fetchCandles({ apiKey: "test-key", symbol: "EUR/USD", fetchImpl: fakeFetch }),
    error => error.kind === "RATE_LIMIT"
  );
});

test("mobile UI v4 keeps one-pair selector, signal light and manual controls", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/);
  assert.ok(html.indexOf("telegram-web-app.js") < html.indexOf("/app.js"));
  assert.equal((html.match(/<option/g) || []).length, 6);
  assert.ok(html.includes('id="feed"'));
  assert.ok(html.includes('id="signalPanel"'));
  assert.match(html, /id="start"/);
  assert.match(html, /id="stop"/);
  assert.match(html, /id="sound"/);
  assert.match(html, /id="vibration"/);
  assert.match(js, /async function authenticate\(\)/);
  assert.ok(js.includes("tg()?.initData"));
  assert.ok(js.includes('request("/api/control"'));
  assert.ok(js.includes("setInterval(poll,2000)"));
  assert.ok(js.includes("h.impactOccurred"));
  assert.ok(js.includes("h.notificationOccurred"));
  assert.match(css, /\.signal-panel\.call/);
  assert.match(css, /\.signal-panel\.put/);
  assert.doesNotMatch(js, /sendOrder\(|placeOrder\(/);
});
test("pre-candle alerts retain a valid direction after the 40-second display hold", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.ok(server.includes("preAlertSignal: null"));
  assert.ok(server.includes("feed.preAlertSignal = result.signal"));
  assert.ok(server.includes("preAlertSignal: feed.preAlertSignal"));
  assert.ok(js.includes('includes(feed.preAlertSignal)'));
  assert.ok(js.includes('remaining <= 10 && remaining > 3'));
  assert.ok(js.includes('remaining <= 3 && remaining > 0'));
});

test("HTTP smoke test serves Mini App and accepts start, heartbeat and stop", async () => {
  const port = 32189;
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), TWELVE_DATA_API_KEY: "", TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN },
    stdio: "ignore"
  });
  try {
    let response;
    for (let i = 0; i < 60; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {}
      await delay(100);
    }
    assert.ok(response?.ok, "server did not become ready");
    const health = await response.json();
    assert.equal(health.service, "main-market");
    assert.equal(health.interval, "1min");
    assert.equal(health.configuration.minimumClosedCandles, 60);
    assert.equal(health.configuration.historyCandles, 80);
    assert.equal(health.configuration.streamingRequiredForSignals, true);
    assert.equal(typeof health.configuration.telegramBotToken, "boolean");
    assert.equal(typeof health.configuration.twelveDataApiKey, "boolean");
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control") || "", /no-store/);
    assert.match(await page.text(), /UNIVERSAL RADAR/);
    const deniedState = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(deniedState.status, 401);
    const deniedControl = await fetch(`http://127.0.0.1:${port}/api/control`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", symbol: "EUR/USD" })
    });
    assert.equal(deniedControl.status, 401);
    const { default: WebSocketClient } = await import("ws");
    const deniedSocketStatus = await new Promise(resolve => {
      const deniedSocket = new WebSocketClient(`ws://127.0.0.1:${port}/live`);
      deniedSocket.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      deniedSocket.on("error", () => resolve(0));
    });
    assert.equal(deniedSocketStatus, 401);
    const foreignOriginStatus = await new Promise(resolve => {
      const foreignSocket = new WebSocketClient(`ws://127.0.0.1:${port}/live`, {
        headers: { Origin: "https://evil.example" }
      });
      foreignSocket.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      foreignSocket.on("error", () => resolve(0));
    });
    assert.equal(foreignOriginStatus, 403);
    const authResponse = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: signedInitData() })
    });
    assert.equal(authResponse.status, 200);
    const cookie = authResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const authenticatedState = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { cookie } });
    assert.equal(authenticatedState.status, 200);
    const liveSocket = new WebSocketClient(`ws://127.0.0.1:${port}/live`, { headers: { Cookie: cookie, Origin: "https://ai-universal-signal-radar.onrender.com" } });
    const liveMessage = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("authenticated WebSocket timed out")), 1500);
      liveSocket.once("message", data => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
      });
      liveSocket.once("error", error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    assert.equal(liveMessage.type, "market_state");
    liveSocket.close();
    const start = await fetch(`http://127.0.0.1:${port}/api/control`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "start", symbol: "EUR/USD" })
    });
    assert.equal(start.status, 200);
    assert.equal((await start.json()).state.monitoring, true);
    const heartbeat = await fetch(`http://127.0.0.1:${port}/api/control`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "heartbeat" })
    });
    assert.equal(heartbeat.status, 200);
    const stop = await fetch(`http://127.0.0.1:${port}/api/control`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "stop" })
    });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).state.monitoring, false);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      delay(1500)
    ]);
  }
}, { timeout: 15000 });
