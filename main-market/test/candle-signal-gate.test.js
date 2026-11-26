import test from "node:test";
import assert from "node:assert/strict";
import { resolveClosedCandleSignal } from "../src/candle-signal-gate.js";

const closed = { epoch: 120, open: 1, high: 1.1, low: 0.9, close: 1.05, live: false };
const live = { epoch: 180, open: 1.05, high: 1.06, low: 1.04, close: 1.055, live: true };
const base = {
  state: { sourceEpoch: null, result: null },
  closedCandles: [closed],
  liveCandle: live,
  monitoring: true,
  monitoringStartedAt: 180_000,
  tickAgeSeconds: 1,
  now: 181_000
};

test("emits a directional signal for the immediately following M1 candle", () => {
  const result = resolveClosedCandleSignal({ ...base, predict: () => ({ signal: "CALL", callRatio: 70 }) });
  assert.equal(result.signal, "CALL");
  assert.equal(result.sourceCandleEpoch, 120);
  assert.equal(result.targetCandleEpoch, 180);
  assert.equal(result.oneSignalPerClosedCandle, true);
  assert.ok(result.alertId);
});

test("repeated polls reuse the same result and never call the analyzer twice", () => {
  const state = { sourceEpoch: null, result: null };
  let calls = 0;
  const first = resolveClosedCandleSignal({ ...base, state, predict: () => { calls++; return { signal: "PUT" }; } });
  const second = resolveClosedCandleSignal({ ...base, state, now: 182_500, predict: () => { calls++; return { signal: "CALL" }; } });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test("does not issue a late signal after the 10-second next-candle entry window", () => {
  const state = { sourceEpoch: null, result: null };
  const result = resolveClosedCandleSignal({ ...base, state, now: 191_000, predict: () => ({ signal: "CALL" }) });
  assert.equal(result.signal, "STANDBY");
  assert.equal(result.entryWindowExpired, true);
  const second = resolveClosedCandleSignal({ ...base, state, now: 192_000, predict: () => ({ signal: "CALL" }) });
  assert.deepEqual(second, result);
});

test("does not signal on a candle that was already open before monitoring began", () => {
  const result = resolveClosedCandleSignal({ ...base, monitoringStartedAt: 180_500, predict: () => ({ signal: "CALL" }) });
  assert.equal(result.signal, "STANDBY");
  assert.match(result.reason, /รอแท่งใหม่/);
});

test("waits for a fresh streaming tick before consuming the candle", () => {
  const state = { sourceEpoch: null, result: null };
  const waiting = resolveClosedCandleSignal({ ...base, state, tickAgeSeconds: 8, predict: () => ({ signal: "CALL" }) });
  assert.equal(waiting.signal, "STANDBY");
  assert.equal(state.sourceEpoch, null);
  const ready = resolveClosedCandleSignal({ ...base, state, now: 182_000, tickAgeSeconds: 1, predict: () => ({ signal: "PUT" }) });
  assert.equal(ready.signal, "PUT");
});

test("does not re-show a cached signal after monitoring is restarted mid-target-candle", () => {
  const state = { sourceEpoch: null, result: null };
  resolveClosedCandleSignal({ ...base, state, predict: () => ({ signal: "CALL" }) });
  const afterRestart = resolveClosedCandleSignal({
    ...base, state, monitoringStartedAt: 180_500, now: 182_000,
    predict: () => ({ signal: "PUT" })
  });
  assert.equal(afterRestart.signal, "STANDBY");
  assert.equal(afterRestart.alreadyIssued, true);
});
