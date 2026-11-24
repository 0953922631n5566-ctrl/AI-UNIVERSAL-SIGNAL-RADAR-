import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithGemini, assessGeminiSetup, buildTechnicalIndicators, clearGeminiAnalysisCache, geminiQuotaStatus, hasCriticalRiskFlags } from "../src/gemini-analyzer.js";

function candles(count = 54) {
  const start = Math.floor(Date.now() / 60000) * 60 - count * 60;
  return Array.from({ length: count }, (_, i) => {
    const open = 1.08 + i * 0.00001;
    const close = open + 0.00002;
    return { epoch: start + i * 60, open, high: close + 0.00001, low: open - 0.00001, close, live: false };
  });
}
function live(epoch) { return { epoch, open: 1.081, high: 1.0812, low: 1.0809, close: 1.0811, live: true }; }
function mockFetch(signal = "CALL", confidence = 77) {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.contents[0].parts[0].text.includes("targetCandleEpoch"), true);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      signal, regime: signal === "PUT" ? "DOWNTREND" : "UPTREND", confidence,
      reason: "หลักฐานสอดคล้อง", evidence: ["EMA", "RSI"], riskFlags: [], summary: "ทิศทางชัด"
    }) }] } }] }) };
  };
  return { fetchImpl, get calls() { return calls; } };
}

test("technical indicators are calculated locally from Twelve Data OHLC", () => {
  const values = buildTechnicalIndicators(candles(), live(Math.floor(Date.now() / 60000) * 60));
  for (const key of ["ema9", "ema21", "ema50", "rsi14", "macd", "macdSignal", "macdHistogram", "atr14", "support20", "resistance20"]) {
    assert.ok(Number.isFinite(values[key]), key);
  }
});

test("local prefilter suppresses weak or sideways setups before any Gemini request", () => {
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const flat = Array.from({ length: 54 }, (_, i) => ({
    epoch: sourceEpoch - (54 - i) * 60, open: 1.08, high: 1.0801, low: 1.0799, close: 1.08, live: false
  }));
  const result = assessGeminiSetup(flat, { epoch: sourceEpoch, open: 1.08, high: 1.0801, low: 1.0799, close: 1.08, live: true });
  assert.equal(result.eligible, false);
  assert.equal(result.direction, null);
});

test("local prefilter marks a candidate only when trend, momentum and live candle align", () => {
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const history = [];
  let close = 1.08;
  for (let i = 0; i < 54; i++) {
    const open = close;
    close = 1.08 + i * 0.00001 + Math.sin(i * 1.1) * 0.00008;
    history.push({ epoch: sourceEpoch - (54 - i) * 60, open, high: Math.max(open, close) + 0.00001, low: Math.min(open, close) - 0.00001, close, live: false });
  }
  const open = close;
  const liveClose = open + 0.00002;
  const liveCandle = { epoch: sourceEpoch, open, high: liveClose + 0.00001, low: open - 0.00001, close: liveClose, live: true };
  const result = assessGeminiSetup(history, liveCandle);
  assert.equal(result.eligible, true);
  assert.equal(result.direction, "CALL");
  assert.ok(Number.isFinite(result.indicators.macdHistogram));
});

test("adaptive prefilter accepts moderate trend setups when either MACD or RSI confirms", () => {
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const history = [];
  let close = 1.08;
  for (let i = 0; i < 54; i++) {
    const open = close;
    close = 1.08 + i * 0.000012 + Math.sin(i * 0.7) * 0.00004;
    history.push({ epoch: sourceEpoch - (54 - i) * 60, open, high: Math.max(open, close) + 0.000015, low: Math.min(open, close) - 0.000015, close, live: false });
  }
  const open = close;
  const liveClose = open + 0.00001;
  const current = { epoch: sourceEpoch, open, high: liveClose + 0.00001, low: open - 0.00001, close: liveClose, live: true };
  const result = assessGeminiSetup(history, current);
  assert.equal(result.eligible, true);
  assert.equal(result.direction, "CALL");
});

test("Gemini analyzes the current live candle and explicitly targets the next M1 candle", async () => {
  clearGeminiAnalysisCache();
  process.env.GEMINI_API_KEY = "test-key";
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const mock = mockFetch("PUT");
  const result = await analyzeWithGemini({ symbol: "EUR/USD", closedCandles: candles(), liveCandle: live(sourceEpoch), fetchImpl: mock.fetchImpl });
  assert.equal(result.signal, "PUT");
  assert.equal(result.sourceCandleEpoch, sourceEpoch);
  assert.equal(result.targetCandleEpoch, sourceEpoch + 60);
  assert.equal(mock.calls, 1);
});

test("fractional Gemini confidence is normalized to the 0-100 evidence scale", async () => {
  clearGeminiAnalysisCache();
  process.env.GEMINI_API_KEY = "test-key";
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const mock = mockFetch("PUT", 0.65);
  const result = await analyzeWithGemini({
    symbol: "EUR/USD", closedCandles: candles(), liveCandle: live(sourceEpoch), fetchImpl: mock.fetchImpl
  });
  assert.equal(result.confidence, 65);
});

test("repeated ticks in the same source candle reuse one Gemini request", async () => {
  clearGeminiAnalysisCache();
  process.env.GEMINI_API_KEY = "test-key";
  const sourceEpoch = Math.floor(Date.now() / 60000) * 60;
  const mock = mockFetch("CALL");
  const args = { symbol: "EUR/USD", closedCandles: candles(), liveCandle: live(sourceEpoch), fetchImpl: mock.fetchImpl };
  const [a, b] = await Promise.all([analyzeWithGemini(args), analyzeWithGemini(args)]);
  assert.equal(a.signal, "CALL");
  assert.equal(b.signal, "CALL");
  assert.equal(mock.calls, 1);
});

test("missing API key fails closed and does not invent a direction", async () => {
  clearGeminiAnalysisCache();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEYS;
  const result = await analyzeWithGemini({ symbol: "EUR/USD", closedCandles: candles(), liveCandle: live(Math.floor(Date.now() / 60000) * 60) });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /GEMINI_API_KEY/);
});

test("risk gate allows ordinary caution flags but blocks critical market/data risks", () => {
  assert.equal(hasCriticalRiskFlags(["price near resistance", "minor pullback"]), false);
  assert.equal(hasCriticalRiskFlags(["high volatility"]), true);
  assert.equal(hasCriticalRiskFlags(["ข้อมูลไม่ครบ"]), true);
});

test("one request budget is tracked per UTC day and can be configured", () => {
  clearGeminiAnalysisCache();
  process.env.GEMINI_MAX_REQUESTS_PER_DAY = "3";
  const state = geminiQuotaStatus(Date.UTC(2026, 10, 24, 12));
  assert.equal(state.dailyBudget, 3);
  assert.equal(state.remaining, 3);
  delete process.env.GEMINI_MAX_REQUESTS_PER_DAY;
});
