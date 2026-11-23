import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_STRATEGY } from "../src/engine-four.js";
import { isSignalFinalizeWindow, canFinalizeSignal } from "../src/signal-timing.js";

const source = 1_800_000_000;
const target = source + 60;

function makeHistory({ count = 40, direction = 1, flat = false, accelerating = false } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const mid = 1.1 + (flat ? 0 : direction * (accelerating ? i * i * 0.0000005 : i * 0.0001));
    rows.push({
      epoch: source - (count - i) * 60,
      open: mid - 0.00002,
      high: mid + 0.00005,
      low: mid - 0.00005,
      close: mid + 0.00002,
      live: false,
      provisional: false
    });
  }
  return rows;
}

function liveCandle(overrides = {}) {
  return {
    epoch: source, open: 1.104, high: 1.1041, low: 1.1039,
    close: 1.104, live: false, provisional: true, ...overrides
  };
}

test("strong expanding AO 5/34 above zero produces CALL for the next M1 candle", () => {
  const history = makeHistory({ count: 60, direction: 1, accelerating: true });
  const live = liveCandle({ open: 1.106, high: 1.1061, low: 1.1059, close: 1.106 });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.candidateSignal, "CALL");
  assert.equal(result.analysisMode, "AO_STRONG_MOMENTUM");
  assert.equal(result.metrics.aoPeriod.fast, 5);
  assert.equal(result.metrics.aoPeriod.slow, 34);
  assert.ok(result.metrics.awesomeOscillator > 0);
  assert.equal(result.metrics.aoExpanding, true);
  assert.equal(result.metrics.aoSameDirection, true);
  assert.ok(result.metrics.aoAtrRatio >= 0.12);
  assert.equal("momentumPercent" in result.metrics, false);
  assert.equal(result.targetCandleEpoch, target);
  assert.equal(result.strategy, ENGINE4_STRATEGY);
  assert.equal("score" in result, false);
  assert.equal("confidence" in result, false);
  assert.equal("regime" in result, false);
});

test("strong expanding AO 5/34 below zero produces PUT for the next M1 candle", () => {
  const history = makeHistory({ direction: -1, accelerating: true });
  const live = liveCandle({ open: 1.096, high: 1.0961, low: 1.0959, close: 1.096 });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
  assert.ok(result.metrics.awesomeOscillator < 0);
  assert.equal(result.metrics.aoExpanding, true);
  assert.ok(result.metrics.aoAtrRatio >= 0.12);
});

test("AO exactly on zero line does not invent a direction", () => {
  const history = makeHistory({ flat: true });
  const live = liveCandle({ open: 1.1, high: 1.10005, low: 1.09995, close: 1.1 });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, false);
  assert.equal(result.status, "AO_ZERO_LINE");
  assert.equal(result.signal, null);
});

test("requires 36 valid M1 samples including the live preview for momentum confirmation", () => {
  const short = makeHistory({ count: 32 });
  const live = liveCandle();
  assert.equal(analyzeEarlyEntryEngine4([...short, live], { liveCandle: live }).status,
    "INSUFFICIENT_HISTORY");
  assert.equal(analyzeEarlyEntryEngine4([], { liveCandle: { ...live, provisional: false } }).status,
    "LIVE_M1_PREVIEW_NOT_READY");
});

test("retains T-5 finalization window and fresh-tick guard", () => {
  assert.equal(isSignalFinalizeWindow(source, source * 1000 + 54999), false);
  assert.equal(isSignalFinalizeWindow(source, source * 1000 + 55000), true);
  assert.equal(isSignalFinalizeWindow(source, source * 1000 + 59999), true);
  assert.equal(isSignalFinalizeWindow(source, source * 1000 + 60000), false);
  assert.equal(canFinalizeSignal({ candleEpoch: source, tickAt: source * 1000 + 55100,
    now: source * 1000 + 55200, lastDispatchedCandle: null }), true);
  assert.equal(canFinalizeSignal({ candleEpoch: source, tickAt: source * 1000 + 55100,
    now: source * 1000 + 55200, lastDispatchedCandle: source }), false);
});


test("positive AO alone is not enough when momentum is weak or not expanding", () => {
  const history = makeHistory({ count: 60, direction: 1 });
  const live = liveCandle({ open: 1.106, high: 1.1061, low: 1.1059, close: 1.106 });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
  assert.equal(result.candidateSignal, null);
  assert.equal(result.status, "AO_MOMENTUM_WEAK");
});
