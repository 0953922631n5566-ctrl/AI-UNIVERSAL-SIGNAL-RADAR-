import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrendRider } from "../src/trend-rider.js";

const baseEpoch = Date.parse("2026-11-23T12:00:00Z") / 1000;
function candles(direction = "UP", count = 54) {
  return Array.from({ length: count }, (_, i) => {
    const close = direction === "UP" ? 1.1 + i * 0.00005 : 1.2 - i * 0.00005;
    return direction === "UP"
      ? { epoch: baseEpoch + i * 60, open: close - 0.00008, close,
          high: close + 0.00004, low: close - 0.00012, live: false }
      : { epoch: baseEpoch + i * 60, open: close + 0.00008, close,
          high: close + 0.00012, low: close - 0.00004, live: false };
  });
}
function setup(direction = "UP") {
  const history = candles(direction);
  const last = history.at(-1);
  const ema5 = direction === "UP" ? last.close - 0.00006 : last.close + 0.00006;
  const ema20 = direction === "UP" ? last.close - 0.00027 : last.close + 0.00027;
  const values = {
    ema5Values: history.slice(-4).map((c, i) => ({
      epoch: c.epoch, ema: ema5 + (direction === "UP" ? -1 : 1) * (3 - i) * 0.00001
    })),
    ema20Values: history.slice(-4).map((c, i) => ({
      epoch: c.epoch, ema: ema20 + (direction === "UP" ? -1 : 1) * (3 - i) * 0.000005
    })),
    atrValues: history.slice(-4).map(c => ({ epoch: c.epoch, atr: 0.0002 }))
  };
  const live = direction === "UP"
    ? { epoch: last.epoch + 60, open: last.close - 0.00003, close: ema5 + 0.00002,
        high: ema5 + 0.00003, low: last.close - 0.00004, live: true }
    : { epoch: last.epoch + 60, open: last.close + 0.00003, close: ema5 - 0.00002,
        high: last.close + 0.00004, low: ema5 - 0.00003, live: true };
  return { history, values, live };
}

test("Engine 3 requires 54 valid closed M1 candles and native Twelve Data indicators", () => {
  const short = candles("UP", 30);
  assert.equal(analyzeTrendRider(short).status, "NOT_READY");
  const { history } = setup("UP");
  assert.equal(analyzeTrendRider(history).status, "TWELVE_DATA_INDICATORS_NOT_READY");
});

test("uptrend triggers CALL intrabar from Twelve Data EMA5/EMA20 and live price action", () => {
  const { history, values, live } = setup("UP");
  const result = analyzeTrendRider(history, { ...values, liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.status, "INSTANT_UPTREND_ENTRY");
  assert.equal(result.provider, "TWELVE_DATA_NATIVE_INDICATORS");
  assert.equal(result.metrics.ema5Source, "Twelve Data /ema time_period=5");
  assert.equal(result.metrics.ema20Source, "Twelve Data /ema time_period=20");
  assert.equal(result.metrics.atr14Source, "Twelve Data /atr time_period=14");
  assert.equal("score" in result, false);
});

test("downtrend triggers PUT intrabar from Twelve Data EMA5/EMA20 and live price action", () => {
  const { history, values, live } = setup("DOWN");
  const result = analyzeTrendRider(history, { ...values, liveCandle: live });
  assert.equal(result.signal, "PUT");
  assert.equal(result.status, "INSTANT_DOWNTREND_ENTRY");
});

test("opposite live candle does not create a counter-trend signal", () => {
  const { history, values, live } = setup("DOWN");
  const opposite = { ...live, open: live.close - 0.00003, close: live.close + 0.00003,
    high: live.close + 0.00004, low: live.close - 0.00004 };
  const result = analyzeTrendRider(history, { ...values, liveCandle: opposite });
  assert.equal(result.signal, null);
  assert.equal(result.status, "WAITING_ENTRY_TRIGGER");
});

test("flat EMA gap is blocked as sideways", () => {
  const { history, values, live } = setup("UP");
  values.ema20Values = values.ema5Values.map(v => ({ ...v, ema: v.ema - 0.000005 }));
  const result = analyzeTrendRider(history, { ...values, liveCandle: live });
  assert.equal(result.signal, null);
  assert.equal(result.status, "SIDEWAYS_BLOCK");
});

test("late entries beyond 1.5 ATR are blocked", () => {
  const { history, values, live } = setup("UP");
  const ema5 = values.ema5Values.at(-1).ema;
  const extended = { ...live, open: ema5 + 0.00028, close: ema5 + 0.00032,
    high: ema5 + 0.00034, low: ema5 + 0.00027 };
  const result = analyzeTrendRider(history, { ...values, liveCandle: extended });
  assert.equal(result.signal, null);
  assert.equal(result.status, "LATE_ENTRY_BLOCK");
});

test("abnormal live M1 range is blocked by native ATR14", () => {
  const { history, values, live } = setup("UP");
  const wide = { ...live, high: live.close + 0.00031, low: live.open - 0.00031 };
  const result = analyzeTrendRider(history, { ...values, liveCandle: wide });
  assert.equal(result.signal, null);
  assert.equal(result.status, "VOLATILITY_BLOCK");
});

test("stale Twelve Data indicators more than one candle behind fail closed", () => {
  const { history, values, live } = setup("UP");
  for (const key of ["ema5Values", "ema20Values", "atrValues"]) {
    values[key] = values[key].map(v => ({ ...v, epoch: v.epoch - 120 }));
  }
  const result = analyzeTrendRider(history, { ...values, liveCandle: live });
  assert.equal(result.signal, null);
  assert.equal(result.status, "TWELVE_DATA_INDICATORS_STALE");
});

test("missing live Streaming candle never produces a directional signal", () => {
  const { history, values } = setup("UP");
  const result = analyzeTrendRider(history, values);
  assert.equal(result.signal, null);
  assert.equal(result.status, "WAITING_LIVE_CANDLE");
});
