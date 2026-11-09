import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES } from "../src/config.js";
import { analyzeMarket, NextM1Analyzer } from "../src/analyzer.js";

function history(count = 220, direction = 1) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  const start = minuteStart - count * 60;
  const candles = [];
  let previous = 1.08;
  for (let i = 0; i < count; i++) {
    const close = 1.08 + direction * i * 0.00004 + Math.sin(i * 0.9) * 0.00015;
    const open = i === count - 1
      ? close - direction * 0.00012
      : previous;
    const epoch = start + i * 60;
    candles.push({
      time: new Date(epoch * 1000).toISOString(), epoch,
      open, high: Math.max(open, close) + 0.00002,
      low: Math.min(open, close) - 0.00002, close, live: false
    });
    previous = close;
  }
  return candles;
}

test("existing source window remains 50 context plus 4 entry candles", () => {
  assert.equal(MIN_CLOSED_CANDLES, 54);
  assert.equal(HISTORY_CANDLES, 54);
  assert.equal(MAX_CANDLES, 60);
});

test("Next-M1 WMA and HMA calculations return finite aligned values", () => {
  const engine = new NextM1Analyzer();
  const candles = history(80);
  const wma = engine.calculateWMA(candles, 3, "close");
  const hma = engine.calculateHMA(candles, 7);
  assert.equal(wma.length, candles.length);
  assert.equal(wma.slice(0, 2).every(value => value === null), true);
  assert.ok(Number.isFinite(wma.at(-1)));
  assert.ok(Number.isFinite(hma.at(-1)));
});

test("Next-M1 RSI handles normal, all-gain and flat markets without NaN", () => {
  const engine = new NextM1Analyzer();
  assert.ok(engine.calculateRSI(Array.from({ length: 20 }, (_, i) => 1 + i * 0.01)) === 100);
  assert.equal(engine.calculateRSI(Array(20).fill(1)), 50);
  assert.equal(engine.calculateRSI([1, 2, 3]), null);
});

test("every valid candle receives CALL or PUT while HMA 50 warms up", () => {
  const engine = new NextM1Analyzer();
  for (const count of [54, 55, 56, 80]) {
    assert.ok(["CALL", "PUT"].includes(engine.evaluateSignal(history(count)).signal));
  }
});

test("flat valid market gets a deterministic low-evidence direction, not a random vote", () => {
  const engine = new NextM1Analyzer();
  const flat = history(54);
  for (const candle of flat) {
    candle.open = 1.08;
    candle.high = 1.0801;
    candle.low = 1.0799;
    candle.close = 1.08;
  }
  const result = engine.evaluateSignal(flat);
  assert.equal(result.signal, "CALL");
  assert.equal(result.confidence, "LOW");
  assert.equal(result.indicators.tieBreak, "NEUTRAL_DEFAULT_CALL");
});

test("aligned bullish HMA and valid RSI/candle conditions produce CALL", () => {
  const engine = new NextM1Analyzer();
  engine.calculateHMA = (candles, period) => { const price = candles.at(-1).close; return Array(candles.length).fill(price - (period === 7 ? 0.0001 : period === 21 ? 0.0002 : 0.0003)); };
  engine.calculateRSI = () => 60;
  engine.analyzeCandle = () => ({ isBullish: true, isValidBody: true, bodyRatio: 0.7 });
  const result = engine.evaluateSignal(history(220, 1));
  assert.equal(result.signal, "CALL");
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.strategy, "NEXT_M1_HMA_RSI_TREND");
  assert.equal(result.indicators.rsi, 60);
});

test("aligned bearish HMA and valid RSI/candle conditions produce PUT", () => {
  const engine = new NextM1Analyzer();
  engine.calculateHMA = (candles, period) => { const price = candles.at(-1).close; return Array(candles.length).fill(price + (period === 7 ? 0.0001 : period === 21 ? 0.0002 : 0.0003)); };
  engine.calculateRSI = () => 40;
  engine.analyzeCandle = () => ({ isBullish: false, isValidBody: true, bodyRatio: 0.7 });
  const result = engine.evaluateSignal(history(220, -1));
  assert.equal(result.signal, "PUT");
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.strategy, "NEXT_M1_HMA_RSI_TREND");
  assert.equal(result.indicators.rsi, 40);
});

test("source quality gate blocks missing, malformed, stale or unapproved data", async () => {
  const candles = history();
  assert.equal((await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: null, allowRestFallback: false
  })).signal, "STANDBY");
  const malformed = history();
  malformed.at(-1).high = malformed.at(-1).low - 0.1;
  assert.equal((await analyzeMarket(malformed, { tickAgeSeconds: 0 })).signal, "STANDBY");
  const stale = history();
  stale.forEach(c => { c.epoch -= 600; });
  assert.equal((await analyzeMarket(stale, { now: Date.now(), tickAgeSeconds: 0 })).signal, "STANDBY");
  assert.equal((await analyzeMarket([], { tickAgeSeconds: 0 })).signal, "STANDBY");
});

test("fresh REST fallback remains available only when explicitly enabled", async () => {
  const candles = history();
  const allowed = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: null, allowRestFallback: true
  });
  assert.equal(allowed.dataMode, "REST_FALLBACK");
  assert.equal(allowed.livePriceReady, true);
  const blocked = await analyzeMarket(candles, {
    now: Date.now(), tickAgeSeconds: null, allowRestFallback: false
  });
  assert.equal(blocked.signal, "STANDBY");
});

test("current live candle is excluded from closed-candle analysis", async () => {
  const candles = history();
  const liveEpoch = Math.floor(Date.now() / 60000) * 60;
  candles.push({ ...candles.at(-1), epoch: liveEpoch, live: true });
  const result = await analyzeMarket(candles, { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(result.closedCandleCount, 220);
  assert.equal(result.lastCandleEpoch, candles.at(-2).epoch);
});

test("analyzer reports required history and preserves the application result contract", async () => {
  const result = await analyzeMarket(history(54), { now: Date.now(), tickAgeSeconds: 0 });
  assert.equal(result.livePriceReady, true);
  assert.equal(result.closedCandleCount, 54);
  assert.equal(result.requiredCandles, 54);
  assert.deepEqual(result.analysisWindow, { contextCandles: 50, entryCandles: 4, total: 54 });
  assert.ok(["CALL", "PUT", "STANDBY"].includes(result.signal));
  assert.equal(result.confidenceMeaning, "RULE_CONDITION_MATCH_NOT_WIN_PROBABILITY");
  assert.equal(result.strategy, "NEXT_M1_HMA_RSI_TREND");
});
