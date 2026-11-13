import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES } from "../src/config.js";
import { analyzeMarket, sourceGate, calculatePureTechnicalSignal } from "../src/analyzer.js";
import { detectMultiStageReversal } from "../src/reversal-detection.js";
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

test("M1 scoring window remains 50 context plus 4 entry candles with 100-candle history", () => {
  assert.equal(MIN_CLOSED_CANDLES, 54);
  assert.equal(HISTORY_CANDLES, 100);
  assert.equal(MAX_CANDLES, 110);
});

test("technical indicator snapshot contains finite M1 EMA, RSI, MACD and ATR values", () => {
  const values = buildTechnicalIndicators(history(80));
  for (const key of ["ema9", "ema21", "ema50", "emaSpreadPercent", "rsi14", "rsi14Previous", "rsi14Change", "macd", "macdSignal", "macdHistogram", "atr14", "support20", "resistance20", "microSupport8", "microResistance8", "microRange8"]) {
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

test.skip("legacy: analyzeMarket uses Gemini with EMA5 and multi-stage reversal context", async () => {
  const candles = history(54, 1);
  const { fetchImpl, calls } = mockFetch(geminiResponse("CALL"));
  const result = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/GEMINI",
    geminiApiKey: "unit-test-key", geminiFetch: fetchImpl
  });
  assert.equal(calls.length, 1);
  assert.equal(result.provider, "GEMINI");
  assert.equal(result.strategy, "GEMINI_PRIMARY_EMA5_SLOPE_FAKEOUT_STRICT_STANDBY");
  assert.equal(result.closedCandleCount, 54);
  assert.ok(["TREND", "REVERSAL_WARNING", "SLOPE_REVERSAL", "REVERSAL_CONFIRMED", "SIDEWAY_STANDBY", "UNCLEAR"].includes(result.reversal.stage));
  const requestBody = JSON.parse(calls[0].init.body);
  const sent = JSON.parse(requestBody.contents[0].parts[0].text).indicators;
  assert.equal(sent.ema5Trend, result.reversal.trend);
  assert.ok(["TREND", "REVERSAL_WARNING", "SLOPE_REVERSAL", "REVERSAL_CONFIRMED", "SIDEWAY_STANDBY", "UNCLEAR"].includes(sent.reversalStage));
});


test("Choppy kill switch overrides directional scoring", async () => {
  const candles = flatSidewayCandles();
  const { fetchImpl, calls } = mockFetch(geminiResponse("CALL"));
  const result = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/SIDEWAY-BLOCK",
    geminiApiKey: "unit-test-key", geminiFetch: fetchImpl
  });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.regime, "SIDEWAY");
  assert.ok(result.riskFlags.includes("CHOPPY_MARKET_KILL_SWITCH"));
  assert.equal(calls.length, 0);
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

test.skip("legacy: missing Gemini API key fails closed while preserving reversal diagnostics", async () => {
  const result = await analyzeMarket(history(54), {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/NO-GEMINI-KEY", geminiApiKey: ""
  });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.provider, "GEMINI");
  assert.ok(result.reversal);
  assert.ok(result.riskFlags.length >= 0);
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
  assert.equal(GEMINI_MODEL, process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
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


function smoothTrendCandles(direction, count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + direction * i * 0.00004;
    const open = close - direction * 0.00002;
    return {
      epoch: start + i * 60, open,
      high: Math.max(open, close) + 0.00004,
      low: Math.min(open, close) - 0.00004,
      close, live: false
    };
  });
}

test("EMA5-only trend flow accepts nearby directional continuation without wick rejection", () => {
  const bullish = calculatePureTechnicalSignal(smoothTrendCandles(1));
  const bearish = calculatePureTechnicalSignal(smoothTrendCandles(-1));
  assert.equal(bullish.signal, "CALL");
  assert.equal(bearish.signal, "PUT");
  assert.equal(bullish.strategy, "EMA5_ONLY_TREND_FLOW");
  assert.equal(bearish.strategy, "EMA5_ONLY_TREND_FLOW");
});


function reversalCandles(direction, count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = [];
  for (let i = 0; i < count; i++) {
    const base = 1.1 + (direction === 1 ? -1 : 1) * i * 0.0001;
    const turn = Math.max(0, i - (count - 4));
    const close = base + direction * turn * 0.00015;
    const open = close - direction * 0.00005;
    candles.push({
      epoch: start + i * 60, open,
      high: Math.max(open, close) + 0.00003,
      low: Math.min(open, close) - 0.00003,
      close, live: false
    });
  }
  return candles;
}

test("EMA20 never blocks an EMA5-confirmed CALL or PUT", () => {
  const bullish = calculatePureTechnicalSignal(reversalCandles(1));
  const bearish = calculatePureTechnicalSignal(reversalCandles(-1));
  assert.equal(bullish.signal, "CALL");
  assert.equal(bullish.metrics.aboveEma5, true);
  assert.equal(bullish.metrics.ema5Rising, true);
  assert.ok(bullish.metrics.ema20 > bullish.metrics.ema5);
  assert.equal(bullish.metrics.ema20InformationalOnly, true);
  assert.equal(bearish.signal, "PUT");
  assert.equal(bearish.metrics.belowEma5, true);
  assert.equal(bearish.metrics.ema5Falling, true);
  assert.ok(bearish.metrics.ema20 < bearish.metrics.ema5);
  assert.equal(bearish.metrics.ema20InformationalOnly, true);
});

test("EMA5-only strategy does not require EMA5 touch, ATR proximity, or wick size", () => {
  const bullish = calculatePureTechnicalSignal(smoothTrendCandles(1));
  const bearish = calculatePureTechnicalSignal(smoothTrendCandles(-1));
  assert.equal(bullish.strategy, "EMA5_ONLY_TREND_FLOW");
  assert.equal(bearish.strategy, "EMA5_ONLY_TREND_FLOW");
  assert.equal(bullish.metrics.aboveEma5, true);
  assert.equal(bearish.metrics.belowEma5, true);
  assert.equal("proximityLimit" in bullish.metrics, false);
  assert.equal("nearEma5" in bullish.metrics, false);
});


function reversalTestCandles(direction = 1, count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = [];
  let close = 1.1;
  for (let i = 0; i < count; i++) {
    const step = i < count - 2 ? direction * 0.0001 : direction * 0.0001;
    const open = close;
    close += step;
    candles.push({
      epoch: start + i * 60, open,
      high: Math.max(open, close) + 0.00002,
      low: Math.min(open, close) - 0.00002,
      close, live: false
    });
  }
  return candles;
}

test("multi-stage detector identifies EMA5 trend without EMA20 gating", () => {
  const state = detectMultiStageReversal(reversalTestCandles(1));
  assert.equal(state.stage, "TREND");
  assert.equal(state.trend, "UPTREND");
  assert.equal(state.warning, null);
});

test("multi-stage detector raises an early bearish warning before EMA5 trend breaks", () => {
  const candles = reversalTestCandles(1);
  const previous = candles.at(-2);
  const last = candles.at(-1);
  last.open = previous.close + 0.00002;
  last.close = previous.close + 0.000005;
  last.high = previous.close + 0.0002;
  last.low = last.close - 0.000005;
  const state = detectMultiStageReversal(candles);
  assert.equal(state.trend, "UPTREND");
  assert.equal(state.stage, "REVERSAL_WARNING");
  assert.equal(state.warning, "BEARISH");
  assert.equal(state.confirmedDirection, null);
});

test("multi-stage detector confirms bearish reversal only after a prior swing-low close break", () => {
  const candles = reversalTestCandles(1);
  const last = candles.at(-1);
  const priorSwingLow = Math.min(...candles.slice(-7, -1).map(c => c.low));
  last.open = priorSwingLow + 0.00003;
  last.close = priorSwingLow - 0.00003;
  last.high = last.open + 0.00001;
  last.low = last.close - 0.00001;
  const state = detectMultiStageReversal(candles);
  assert.equal(state.stage, "REVERSAL_CONFIRMED");
  assert.equal(state.confirmedDirection, "PUT");
});

test("multi-stage detector returns unclear for insufficient history", () => {
  const state = detectMultiStageReversal(reversalTestCandles(1).slice(-20));
  assert.equal(state.stage, "UNCLEAR");
  assert.equal(state.confirmedDirection, null);
});


function flatSidewayCandles(count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  let previous = 1.1;
  return Array.from({ length: count }, (_, i) => ({
    epoch: start + i * 60, open: 1.1,
    high: 1.10001, low: 1.09999, close: 1.1, live: false
  }));
}

function slopeShiftCandles(direction = 1, count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = Array.from({ length: count }, (_, i) => ({
    epoch: start + i * 60, open: 1.1,
    high: 1.10003, low: 1.09997, close: 1.1, live: false
  }));
  const last = candles.at(-1);
  last.open = 1.1;
  last.close = 1.1 + direction * 0.00001;
  last.high = Math.max(last.open, last.close) + 0.000015;
  last.low = Math.min(last.open, last.close) - 0.000015;
  return candles;
}

function fakeoutCandles(direction = 1, count = 54) {
  const candles = slopeShiftCandles(direction, count);
  const prior = candles.slice(-7, -1);
  const swing = direction === 1
    ? Math.min(...prior.map(c => c.low))
    : Math.max(...prior.map(c => c.high));
  const last = candles.at(-1);
  if (direction === 1) {
    last.open = prior.at(-1).close;
    last.close = swing + 0.00018;
    last.low = swing - 0.00024;
    last.high = last.close + 0.000015;
  } else {
    last.open = prior.at(-1).close;
    last.close = swing - 0.00018;
    last.high = swing + 0.00024;
    last.low = last.close - 0.000015;
  }
  return candles;
}

test("EMA5 slope shift from negative to positive confirms CALL only with price above EMA5", () => {
  const state = detectMultiStageReversal(slopeShiftCandles(1));
  assert.equal(state.stage, "SLOPE_REVERSAL");
  assert.equal(state.confirmedDirection, "CALL");
  assert.equal(state.slopeShiftToPositive, true);
});

test("EMA5 slope shift from positive to negative confirms PUT only with price below EMA5", () => {
  const state = detectMultiStageReversal(slopeShiftCandles(-1));
  assert.equal(state.stage, "SLOPE_REVERSAL");
  assert.equal(state.confirmedDirection, "PUT");
  assert.equal(state.slopeShiftToNegative, true);
});

test("support fakeout BEAR_TRAP maps to CALL with lower-wick rejection and EMA5 turn up", () => {
  const state = detectMultiStageReversal(fakeoutCandles(1));
  assert.equal(state.stage, "REVERSAL_CONFIRMED");
  assert.equal(state.pattern, "BEAR_TRAP");
  assert.equal(state.confirmedDirection, "CALL");
});

test("resistance fakeout BULL_TRAP maps to PUT with upper-wick rejection and EMA5 turn down", () => {
  const state = detectMultiStageReversal(fakeoutCandles(-1));
  assert.equal(state.stage, "REVERSAL_CONFIRMED");
  assert.equal(state.pattern, "BULL_TRAP");
  assert.equal(state.confirmedDirection, "PUT");
});


test.skip("legacy: Gemini must agree with EMA5 slope reversal before CALL/PUT can be released", async () => {
  const candles = slopeShiftCandles(1);
  const agreeing = mockFetch(geminiResponse("CALL"));
  const accepted = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/SLOPE-AGREE",
    geminiApiKey: "unit-test-key", geminiFetch: agreeing.fetchImpl
  });
  assert.equal(accepted.reversal.stage, "SLOPE_REVERSAL");
  assert.equal(accepted.signal, "CALL");

  const disagreeing = mockFetch(geminiResponse("PUT"));
  const rejected = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/SLOPE-DISAGREE",
    geminiApiKey: "unit-test-key", geminiFetch: disagreeing.fetchImpl
  });
  assert.equal(rejected.signal, "STANDBY");
  assert.match(rejected.reason, /รอ Gemini ยืนยัน/);
});


test.skip("legacy: Gemini must agree with BEAR_TRAP CALL and BULL_TRAP PUT before fakeout release", async () => {
  const bearTrap = fakeoutCandles(1);
  const callMock = mockFetch(geminiResponse("CALL"));
  const callResult = await analyzeMarket(bearTrap, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/BEAR-TRAP-CALL",
    geminiApiKey: "unit-test-key", geminiFetch: callMock.fetchImpl
  });
  assert.equal(callResult.reversal.pattern, "BEAR_TRAP");
  assert.equal(callResult.signal, "CALL");

  const putMock = mockFetch(geminiResponse("PUT"));
  const bullTrapResult = await analyzeMarket(fakeoutCandles(-1), {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/BULL-TRAP-PUT",
    geminiApiKey: "unit-test-key", geminiFetch: putMock.fetchImpl
  });
  assert.equal(bullTrapResult.reversal.pattern, "BULL_TRAP");
  assert.equal(bullTrapResult.signal, "PUT");

  const mismatchMock = mockFetch(geminiResponse("PUT"));
  const mismatch = await analyzeMarket(bearTrap, {
    now: Date.now(), tickAgeSeconds: 0, symbol: "TEST/BEAR-TRAP-MISMATCH",
    geminiApiKey: "unit-test-key", geminiFetch: mismatchMock.fetchImpl
  });
  assert.equal(mismatch.signal, "STANDBY");
});

import { scoreMarket } from "../src/advanced-scoring.js";
test("Partial Scoring keeps each side's four weighted components within 100 points",()=>{
 const result=scoreMarket(reversalTestCandles(1));
 for(const side of ["CALL","PUT"]){
  const p=result.componentScores[side];
  assert.ok(p.ema5SlopeReversal>=0&&p.ema5SlopeReversal<=30);
  assert.ok(p.srFakeout>=0&&p.srFakeout<=30);
  assert.ok(p.proximityMomentum>=0&&p.proximityMomentum<=20);
  assert.ok(p.trendContext>=0&&p.trendContext<=20);
  assert.ok(result.scores[side]>=0&&result.scores[side]<=100);
 }
});
test("flat tangled EMA5/EMA20 market activates Choppy kill switch",()=>{
 const result=scoreMarket(flatSidewayCandles());
 assert.equal(result.signal,"STANDBY");
 assert.ok(result.riskFlags.includes("CHOPPY_MARKET_KILL_SWITCH"));
});
test("abnormal single-candle range activates High ATR Spike kill switch",()=>{
 const candles=reversalTestCandles(1);
 const last=candles.at(-1);last.high=last.close+0.004;last.low=last.close-0.004;
 const result=scoreMarket(candles);
 assert.equal(result.signal,"STANDBY");
 assert.ok(result.riskFlags.includes("HIGH_ATR_SPIKE_KILL_SWITCH"));
});
test("Experimental Partial Scoring exposes 60/45 entry thresholds",()=>{
 const result=scoreMarket(reversalTestCandles(1));
 assert.deepEqual(result.thresholds,{signal:60,prepare:45,standbyBelow:45});
});

function moderateFakeoutCandles(count = 54) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = [];
  let previous = 1.1;
  for (let i = 0; i < count; i++) {
    const open = previous;
    const close = open + 0.00003;
    candles.push({
      epoch: start + i * 60, open,
      high: close + 0.00025,
      low: open - 0.00025,
      close, live: false
    });
    previous = close;
  }
  const prior = candles.slice(-8, -2);
  const swingLow = Math.min(...prior.map(c => c.low));
  const last = candles.at(-1);
  last.low = swingLow - 0.0001;
  last.high = last.close + 0.00025;
  return candles;
}

test("A 60-69 CALL candidate requires candle confirmation at the 60-point threshold", () => {
  const result = scoreMarket(moderateFakeoutCandles());
  assert.ok(result.scores.CALL >= 60 && result.scores.CALL < 70, JSON.stringify(result.scores));
  assert.equal(result.thresholds.signal, 60);
  assert.ok(["PREPARE", "CALL"].includes(result.signal));
  if (result.scores.CALL < 60 || !result.candleConfirmation?.confirmed) assert.equal(result.signal, "PREPARE");
  assert.equal(result.riskFlags.includes("CHOPPY_MARKET_KILL_SWITCH"), false);
  assert.equal(result.riskFlags.includes("HIGH_ATR_SPIKE_KILL_SWITCH"), false);
});
