import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_STRATEGY } from "../src/engine-four.js";
import { isSignalFinalizeWindow, canFinalizeSignal } from "../src/signal-timing.js";

const source = 1_800_000_000;
const target = source + 60;

function makeHistory({ count = 30, start = 1.1, step = 0.001, wide = false, declines = 0 } = {}) {
  const rows = [];
  let close = start;
  for (let i = 0; i < count; i++) {
    if (i >= count - declines) close -= 0.0001;
    else close += step;
    const open = close - (step >= 0 ? 0.0002 : -0.00002);
    rows.push({
      epoch: source - (count - i) * 60, open,
      high: Math.max(open, close) + (wide ? 0.001 : 0.0002),
      low: Math.min(open, close) - (wide ? 0.001 : 0.0002),
      close, live: false, provisional: false
    });
  }
  return rows;
}

function liveCandle(overrides = {}) {
  return {
    epoch: source, open: 1.1, high: 1.101, low: 1.099,
    close: 1.1005, live: false, provisional: true, ...overrides
  };
}

test("trend regime issues CALL on EMA8 pullback with bullish MACD", () => {
  const history = makeHistory({ step: 0.0001 });
  const previous = history.at(-1).close;
  const live = liveCandle({
    open: previous - 0.0001, close: previous + 0.0008,
    low: previous - 0.0005, high: previous + 0.0009
  });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.analysisMode, "TREND_PULLBACK");
  assert.equal(result.metrics.regime, "TREND");
  assert.equal(result.targetCandleEpoch, target);
  assert.equal(result.strategy, ENGINE4_STRATEGY);
  assert.equal("score" in result, false);
  assert.equal("confidence" in result, false);
});

test("sideway regime issues CALL on lower Bollinger touch with RSI below 30", () => {
  const history = makeHistory({ step: 0, wide: true, declines: 5 });
  const previous = history.at(-1).close;
  const live = liveCandle({
    open: previous - 0.00015, close: previous - 0.00010,
    low: previous - 0.002, high: previous + 0.001
  });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.metrics.regime, "SIDEWAY");
  assert.equal(result.metrics.rsi5 < 30, true);
  assert.equal(result.ready, true);
  assert.equal(result.signal, "CALL");
  assert.equal(result.analysisMode, "RANGE_REVERSAL");
  assert.equal("score" in result, false);
});

test("returns no signal when neither regime has a valid entry", () => {
  const history = makeHistory({ step: 0.001 });
  const previous = history.at(-1).close;
  const live = liveCandle({
    open: previous, close: previous + 0.00001,
    low: previous + 0.000005, high: previous + 0.00002
  });
  const result = analyzeEarlyEntryEngine4([...history, live], { liveCandle: live });
  assert.equal(result.ready, false);
  assert.equal(result.status, "NO_ADAPTIVE_ENTRY");
});

test("requires at least 21 closed candles and a valid live preview", () => {
  const short = makeHistory({ count: 20 });
  const live = liveCandle();
  assert.equal(analyzeEarlyEntryEngine4([...short, live], { liveCandle: live }).status, "INSUFFICIENT_HISTORY");
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
