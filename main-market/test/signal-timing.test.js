import test from "node:test";
import assert from "node:assert/strict";
import {
  canDispatchSignal, isFreshSignalTick, isSignalPreCloseWindow,
  SIGNAL_DISPATCH_COOLDOWN_MS
} from "../src/signal-timing.js";

const candle = 1_800_000_000;
const closeAt = (candle + 60) * 1000;

test("dispatch window includes exactly 5s through 3s before candle close", () => {
  assert.equal(isSignalPreCloseWindow(candle, closeAt - 5000), true);
  assert.equal(isSignalPreCloseWindow(candle, closeAt - 4000), true);
  assert.equal(isSignalPreCloseWindow(candle, closeAt - 3000), true);
  assert.equal(isSignalPreCloseWindow(candle, closeAt - 5001), false);
  assert.equal(isSignalPreCloseWindow(candle, closeAt - 2999), false);
  assert.equal(isSignalPreCloseWindow(candle + 60, closeAt - 4000), false);
});

test("pre-close dispatch requires a tick no older than five seconds", () => {
  assert.equal(isFreshSignalTick(closeAt - 4000, closeAt), true);
  assert.equal(isFreshSignalTick(closeAt - 5000, closeAt), true);
  assert.equal(isFreshSignalTick(closeAt - 5001, closeAt), false);
  assert.equal(isFreshSignalTick(closeAt + 1, closeAt), false);
});

test("per-candle dedupe and 60-second cooldown block repeated dispatches", () => {
  const now = closeAt - 4000;
  const base = { candleEpoch: candle, tickAt: now - 1000, now };
  assert.equal(canDispatchSignal(base), true);
  assert.equal(canDispatchSignal({ ...base, lastDispatchedCandle: candle }), false);
  assert.equal(canDispatchSignal({ ...base, lastDispatchedAt: now - SIGNAL_DISPATCH_COOLDOWN_MS + 1 }), false);
  assert.equal(canDispatchSignal({ ...base, lastDispatchedAt: now - SIGNAL_DISPATCH_COOLDOWN_MS }), true);
});
