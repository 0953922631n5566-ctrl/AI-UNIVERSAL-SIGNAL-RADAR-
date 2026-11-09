import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES } from "../src/config.js";
import { analyzeMarket, sourceGate } from "../src/analyzer.js";
import { analyzeWithGemini, buildTechnicalIndicators, clearGeminiAnalysisCache, GEMINI_MODEL } from "../src/gemini-analyzer.js";

function history(count = 220, direction = 1) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = [];
  let previous = 1.08;
  for (let i = 0; i < count; i++) {
    const close = 1.08 + direction * i * 0.00004 + Math.sin(i * 0.9) * 0.00015;
    const open = i === count - 1 ? close - direction * 0.00012 : previous;
    const epoch = start + i * 60;
    candles.push({
      time: new Date(epoch * 1000).toISOString(), epoch, open,
      high: Math.max(open, close) + 0.00002,
      low: Math.min(open, close) - 0.00002, close, live: false
    });
    previous = close;
  }
  return candles;
}

function geminiResponse(signal = "CALL") {
  return {
    signal, regime: signal === "PUT" ? "DOWNTREND" : "UPTREND",
    confidence: 76, reason: "แนวโน้มและโมเมนตัมสอดคล้องกัน",
    evidence: ["EMA 9 อยู่เหนือ EMA 21", "RSI และ MACD สนับสนุนทิศทาง"],
    riskFlags: [], summary: "มีหลักฐานฝั่งซื้อสอดคล้องกัน"
  };
}

function mockFetch(value = geminiResponse()) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] })
    };
  };
  return { fetchImpl, calls };
}

test("M1 source window remains 50 context plus 4 entry candles", () => {
  assert.equal(MIN_CLOSED_CANDLES, 54);
  assert.equal(HISTORY_CANDLES, 54);
  assert.equal(MAX_CANDLES, 60);
});

test("technical indicator snapshot contains finite M1 EMA, RSI, MACD and ATR values", () => {
  const values = buildTechnicalIndicators(history(80));
  for (const key of ["ema9", "ema21", "ema50", "rsi14", "macd", "macdSignal", "macdHistogram", "atr14", "support20", "resistance20"]) {
    assert.ok(Number.isFinite(values[key]), key + " should be finite");
  }
});

test("source guard rejects missing, malformed, stale or unapproved market data", () => {
  const candles = history();
  assert.equal(sourceGate(candles, { now: Date.now(), tickAgeSeconds: null, allowRestFallback: false }).ready, false);
  const malformed = history();
  malformed.at(-1).high = malformed.at(-1).low - 0.1;
  assert.equal(sourceGate(malformed, { tickAgeSeconds: 0 }).ready, false);
  const stale = history();
  stale.forEach(c => { c.epoch -= 600; });
  assert.equal(sourceGate(stale, { now: Date.now(), tickAgeSeconds: 0 }).ready, false);
  assert.equal(sourceGate([], { tickAgeSeconds: 0 }).ready, false);
});

test("fresh REST fallback passes only the data guard; T-5 still has its separate Streaming freshness gate", () => {
  const result = sourceGate(history(), { now: Date.now(), tickAgeSeconds: null, allowRestFallback: true });
  assert.equal(result.ready, true);
  assert.equal(result.mode, "REST_FALLBACK");
});

test("Gemini alone returns the directional decision in schema-constrained JSON", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const { fetchImpl, calls } = mockFetch(geminiResponse("PUT"));
  const result = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/PUT",
    geminiApiKey: "unit-test-key", geminiFetch: fetchImpl
  });
  assert.equal(result.signal, "PUT");
  assert.equal(result.provider, "GEMINI");
  assert.equal(result.strategy, "GEMINI_PRIMARY_ANALYZER");
  assert.equal(result.confidence, 76);
  assert.equal(result.closedCandleCount, 54);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "unit-test-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseSchema.properties.signal.enum.includes("STANDBY"), true);
});

test("one symbol/closed-candle epoch makes only one Gemini request even with repeated ticks", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const { fetchImpl, calls } = mockFetch();
  const args = { symbol: "TEST/CACHE", candles, indicators: buildTechnicalIndicators(candles), apiKey: "unit-test-key", fetchImpl, now: Date.now() };
  const [first, second] = await Promise.all([analyzeWithGemini(args), analyzeWithGemini(args)]);
  assert.equal(first.signal, "CALL");
  assert.equal(second.signal, "CALL");
  assert.equal(calls.length, 1);
});

test("Gemini makes exactly one HTTP attempt and does not retry transient 429 on Free Tier", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const usedKeys = [], delays = [];
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    usedKeys.push(init.headers["x-goog-api-key"]);
    return {
      ok: false, status: 429,
      clone: () => ({ json: async () => ({ error: { message: "Rate limit exceeded for requests per minute" } }) })
    };
  };
  const result = await analyzeWithGemini({
    symbol: "TEST/SINGLE-SHOT-429", candles, indicators: buildTechnicalIndicators(candles),
    apiKeys: ["free-key-a", "free-key-b"], fetchImpl, now: Date.now(),
    sleepImpl: async ms => delays.push(ms), randomImpl: () => 0
  });
  assert.equal(result.signal, "STANDBY");
  assert.equal(calls, 1);
  assert.deepEqual(usedKeys, ["free-key-a"]);
  assert.deepEqual(delays, []);
  assert.equal(result.providerStatus, "ERROR");
});

test("Gemini does not retry a daily quota exhaustion 429", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  let calls = 0;
  const result = await analyzeWithGemini({
    symbol: "TEST/DAILY-QUOTA", candles, indicators: buildTechnicalIndicators(candles),
    apiKey: "free-key", fetchImpl: async () => {
      calls++;
      return { ok: false, status: 429,
        clone: () => ({ json: async () => ({ error: { message: "Requests per day quota exceeded" } }) }) };
    }, now: Date.now(), sleepImpl: async () => assert.fail("daily quota must not retry")
  });
  assert.equal(result.signal, "STANDBY");
  assert.equal(calls, 1);
});

test("missing Gemini key fails closed and never uses a local directional fallback", async () => {
  clearGeminiAnalysisCache();
  const result = await analyzeMarket(history(54), {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/NO-KEY", geminiApiKey: ""
  });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /GEMINI_API_KEY/);
  assert.equal(result.provider, "GEMINI");
});

test("invalid Gemini JSON or an API failure returns STANDBY instead of a heuristic vote", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const badFetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{bad json" }] } }] }) });
  const result = await analyzeWithGemini({
    symbol: "TEST/BAD-JSON", candles, indicators: buildTechnicalIndicators(candles),
    apiKey: "unit-test-key", fetchImpl: badFetch, now: Date.now()
  });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /invalid JSON/);
});

test("the selected Gemini model is an explicit stable Flash model", () => {
  assert.equal(GEMINI_MODEL, "gemini-3.6-flash");
});

test("Gemini emits structured request, response, and final decision observability events", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const { fetchImpl } = mockFetch(geminiResponse("CALL"));
  const events = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args) => events.push(args);
  console.error = (...args) => events.push(args);
  try {
    const result = await analyzeWithGemini({
      symbol: "TEST/OBSERVABILITY", candles,
      indicators: buildTechnicalIndicators(candles),
      apiKey: "unit-test-key", fetchImpl, now: Date.now()
    });
    assert.equal(result.signal, "CALL");
    assert.ok(events.some(([name]) => name === "[gemini] request_started"));
    assert.ok(events.some(([name]) => name === "[gemini] response_success"));
    assert.ok(events.some(([name]) => name === "[gemini] final_decision"));
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test("Gemini request failures emit a structured failure event and fail closed", async () => {
  clearGeminiAnalysisCache();
  const candles = history(54);
  const events = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args) => events.push(args);
  console.error = (...args) => events.push(args);
  try {
    const result = await analyzeWithGemini({
      symbol: "TEST/OBSERVABILITY-FAIL", candles,
      indicators: buildTechnicalIndicators(candles),
      apiKey: "unit-test-key",
      fetchImpl: async () => { throw new Error("network unavailable"); },
      now: Date.now()
    });
    assert.equal(result.signal, "STANDBY");
    assert.ok(events.some(([name, detail]) => name === "[gemini] request_failed" && detail.error === "network unavailable"));
    assert.ok(events.some(([name, detail]) => name === "[gemini] final_decision" && detail.signal === "STANDBY"));
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});
