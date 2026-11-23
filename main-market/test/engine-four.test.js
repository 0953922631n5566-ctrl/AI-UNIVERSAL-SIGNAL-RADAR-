import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_STRATEGY } from "../src/engine-four.js";

const now = Date.parse("2026-11-23T12:02:30Z");
const source = Math.floor(now / 60000) * 60;
const emaUp = [{ epoch: source - 120, ema: 1.10000 }, { epoch: source - 60, ema: 1.10010 }];
const emaDown = [{ epoch: source - 120, ema: 1.10010 }, { epoch: source - 60, ema: 1.10000 }];
const tick = price => ({ livePrice: price, tickAt: now, now, sourceCandleEpoch: source, symbol: "EUR/USD" });

test("Twelve Data EMA5 rising + pullback + rebound produces immediate CALL", () => {
  let result = analyzeEarlyEntryEngine4({ ...tick(1.10020), emaValues: emaUp });
  assert.equal(result.status, "EMA5_WAITING_FOR_PULLBACK");
  result = analyzeEarlyEntryEngine4({ ...tick(1.10013), emaValues: emaUp, state: result.nextState });
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
  result = analyzeEarlyEntryEngine4({ ...tick(1.10010), emaValues: emaUp, state: result.nextState });
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
  result = analyzeEarlyEntryEngine4({ ...tick(1.10013), emaValues: emaUp, state: result.nextState });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.entryPrice, 1.10013);
  assert.equal(result.strategy, ENGINE4_STRATEGY);
  assert.equal(result.targetCandleEpoch, source);
  assert.equal(result.entryPriceBasis, "TWELVE_DATA_STREAM_PULLBACK_BOUNCE_PRICE");
  for (const key of ["score","confidence","candidateScore","momentumPercent","macdLine"]) assert.equal(key in result, false);
});

test("Twelve Data EMA5 falling + upward pullback + rejection produces immediate PUT", () => {
  let result = analyzeEarlyEntryEngine4({ ...tick(1.09980), emaValues: emaDown });
  assert.equal(result.status, "EMA5_WAITING_FOR_PULLBACK");
  result = analyzeEarlyEntryEngine4({ ...tick(1.09996), emaValues: emaDown, state: result.nextState });
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
  result = analyzeEarlyEntryEngine4({ ...tick(1.10000), emaValues: emaDown, state: result.nextState });
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
  result = analyzeEarlyEntryEngine4({ ...tick(1.09997), emaValues: emaDown, state: result.nextState });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
});

test("touching EMA5 without rebound remains STANDBY", () => {
  let result = analyzeEarlyEntryEngine4({ ...tick(1.10020), emaValues: emaUp });
  result = analyzeEarlyEntryEngine4({ ...tick(1.10013), emaValues: emaUp, state: result.nextState });
  result = analyzeEarlyEntryEngine4({ ...tick(1.10011), emaValues: emaUp, state: result.nextState });
  assert.equal(result.ready, false);
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
});

test("flat/missing/stale EMA and stale live price fail closed", () => {
  assert.equal(analyzeEarlyEntryEngine4({ ...tick(1.1), emaValues: [] }).status, "EMA5_API_NOT_READY");
  assert.equal(analyzeEarlyEntryEngine4({ ...tick(1.1), emaValues: [
    { epoch: source - 120, ema: 1.1 }, { epoch: source - 60, ema: 1.1 }
  ] }).status, "EMA5_SLOPE_FLAT");
  assert.equal(analyzeEarlyEntryEngine4({ ...tick(1.1), emaValues: [
    { epoch: source - 600, ema: 1.1 }, { epoch: source - 540, ema: 1.1001 }
  ] }).status, "EMA5_API_STALE");
  assert.equal(analyzeEarlyEntryEngine4({ ...tick(1.1), tickAt: now - 6000, emaValues: emaUp }).status, "LIVE_PRICE_STALE");
});

test("only one Engine 4 signal is permitted per M1 candle", () => {
  const state = { direction: "CALL", emaEpoch: source - 60, phase: "TRIGGERED",
    extremePrice: 1.1, triggeredCandleEpoch: source };
  assert.equal(analyzeEarlyEntryEngine4({ ...tick(1.1002), emaValues: emaUp, state }).status,
    "EMA5_ALREADY_TRIGGERED_THIS_CANDLE");
});

test("an armed pullback survives the next EMA5 refresh when slope direction stays the same", () => {
  let result = analyzeEarlyEntryEngine4({ ...tick(1.10020), emaValues: emaUp });
  result = analyzeEarlyEntryEngine4({ ...tick(1.10013), emaValues: emaUp, state: result.nextState });
  const nextMinute = source + 60;
  const nextNow = now + 60000;
  const refreshed = [
    { epoch: source - 60, ema: 1.10010 },
    { epoch: source, ema: 1.10020 }
  ];
  result = analyzeEarlyEntryEngine4({
    emaValues: refreshed, livePrice: 1.10024, tickAt: nextNow, now: nextNow,
    sourceCandleEpoch: nextMinute, symbol: "EUR/USD", state: result.nextState
  });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
});

test("JPY pairs use 0.01 pip sizing for pullback and rebound distances", () => {
  const jpyEma = [{ epoch: source - 120, ema: 150.02 }, { epoch: source - 60, ema: 150.01 }];
  let result = analyzeEarlyEntryEngine4({
    ...tick(149.99), symbol: "USD/JPY", emaValues: jpyEma
  });
  assert.equal(result.status, "EMA5_WAITING_FOR_PULLBACK");
  result = analyzeEarlyEntryEngine4({
    ...tick(150.006), symbol: "USD/JPY", emaValues: jpyEma, state: result.nextState
  });
  assert.equal(result.status, "EMA5_WAITING_FOR_REBOUND");
  result = analyzeEarlyEntryEngine4({
    ...tick(150.008), symbol: "USD/JPY", emaValues: jpyEma, state: result.nextState
  });
  result = analyzeEarlyEntryEngine4({
    ...tick(150.003), symbol: "USD/JPY", emaValues: jpyEma, state: result.nextState
  });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
});
