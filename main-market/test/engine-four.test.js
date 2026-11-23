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
function reversalCandles(direction) {
  const history = [];
  for (let i = 0; i < 34; i++) {
    const close = direction === "CALL" ? 1.1 - i * 0.0001 : 1.1 + i * 0.0001;
    history.push(candle(source - (34 - i) * 60, close));
  }
  const liveClose = 1.1;
  const live = candle(source, liveClose, true);
  return { history, live };
}

test("MACD 12/26/9 bullish crossover produces CALL for the next M1 candle without scores", () => {
  const { history, live } = reversalCandles("CALL");
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.candidateSignal, "CALL");
  assert.equal(result.status, "MACD_BULLISH_CROSS");
  assert.deepEqual(result.metrics.periods, { fast: 12, slow: 26, signal: 9 });
  assert.ok(result.metrics.macdLine > result.metrics.signalLine);
  assert.equal(result.targetCandleEpoch, target);
  assert.equal(result.strategy, ENGINE4_STRATEGY);
  for (const key of ["score", "confidence", "candidateScore", "momentumPercent"]) {
    assert.equal(key in result, false);
  }
});

test("MACD 12/26/9 bearish crossover produces PUT for the next M1 candle", () => {
  const { history, live } = reversalCandles("PUT");
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "PUT");
  assert.equal(result.status, "MACD_BEARISH_CROSS");
  assert.ok(result.metrics.macdLine < result.metrics.signalLine);
});

test("MACD without a crossover stays STANDBY", () => {
  const history = [];
  for (let i = 0; i < 40; i++) history.push(candle(source - (40 - i) * 60, 1.1 + i * 0.0001));
  const live = candle(source, 1.104, true);
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, false);
  assert.equal(result.signal, null);
  assert.equal(result.status, "MACD_NO_CROSS");
});

test("requires 35 valid M1 samples and a live preview", () => {
  const short = Array.from({ length: 33 }, (_, i) => candle(source - (33 - i) * 60, 1.1 + i * 0.0001));
  const live = candle(source, 1.104, true);
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
