import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_STRATEGY } from "../src/engine-four.js";
import { isSignalFinalizeWindow, canFinalizeSignal } from "../src/signal-timing.js";

const source = 1_800_000_000;
const target = source + 60;

function candle(epoch, close, provisional = false) {
  return { epoch, open: close, high: close + 0.00002, low: close - 0.00002,
    close, live: false, provisional };
}
function trendCandles(direction) {
  const history = [];
  for (let i = 0; i < 73; i++) {
    const close = direction === "CALL" ? 1.1 - i * 0.0001 : 1.1 + i * 0.0001;
    history.push(candle(source - (73 - i) * 60, close));
  }
  return history;
}
function liveAt(close) { return candle(source, close, true); }

test("MACD bullish crossover produces CALL without score fields", () => {
  const history = trendCandles("CALL"), live = liveAt(1.1);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.status, "MACD_BULLISH_CROSS");
  assert.equal(result.trigger, "CROSSOVER");
  assert.deepEqual(result.metrics.periods, { fast: 12, slow: 26, signal: 9 });
  assert.equal(result.targetCandleEpoch, target);
  assert.equal(result.strategy, ENGINE4_STRATEGY);
  for (const key of ["score", "confidence", "candidateScore", "momentumPercent"]) {
    assert.equal(key in result, false);
  }
});

test("MACD bearish crossover produces PUT without score fields", () => {
  const history = trendCandles("PUT"), live = liveAt(1.1);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
  assert.equal(result.status, "MACD_BEARISH_CROSS");
  assert.equal(result.trigger, "CROSSOVER");
});

test("MACD close to Signal from below produces early CALL before crossing", () => {
  const history = Array.from({ length: 73 }, (_, i) =>
    candle(source - (73 - i) * 60, 1.1 + 0.0002 * Math.sin(i * 0.5)));
  const live = liveAt(history.at(-1).close + 0.000258);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.trigger, "HISTORICAL_PROXIMITY");
  assert.equal(result.status, "MACD_APPROACHING_FROM_BELOW");
  assert.ok(result.metrics.macdLine < result.metrics.signalLine);
  assert.ok(result.metrics.absoluteGap <= result.metrics.historicalProximityThreshold);
  assert.equal(result.metrics.historicalSamples, 40);
});

test("MACD close to Signal from above produces early PUT before crossing", () => {
  const history = Array.from({ length: 73 }, (_, i) =>
    candle(source - (73 - i) * 60, 1.1 + 0.0002 * Math.sin(i * 0.5)));
  const live = liveAt(history.at(-1).close - 0.000258);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
  assert.equal(result.trigger, "HISTORICAL_PROXIMITY");
  assert.equal(result.status, "MACD_APPROACHING_FROM_ABOVE");
  assert.ok(result.metrics.macdLine > result.metrics.signalLine);
});

test("MACD far from Signal remains STANDBY", () => {
  const history = Array.from({ length: 73 }, (_, i) =>
    candle(source - (73 - i) * 60, 1.1 + 0.0002 * Math.sin(i * 0.5)));
  const live = liveAt(history.at(-1).close + 0.0002);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
  assert.equal(result.status, "MACD_NOT_NEAR_SIGNAL");
});

test("requires 74 M1 samples including a live preview and 40 historical gaps", () => {
  const short = Array.from({ length: 72 }, (_, i) =>
    candle(source - (72 - i) * 60, 1.1 + 0.0001 * i));
  const live = liveAt(1.1072);
  assert.equal(analyzeEarlyEntryEngine4([...short, live], { liveCandle: live }).status,
    "INSUFFICIENT_MACD_HISTORY");
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
