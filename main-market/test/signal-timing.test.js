import test from "node:test";
import assert from "node:assert/strict";
import {
  canDispatchSignal, isFreshSignalTick, isSignalEntryWindow,
  SIGNAL_DISPATCH_COOLDOWN_MS
} from "../src/signal-timing.js";

const candle = 1_800_000_000;
const openAt = candle * 1000;

test("entry dispatch window covers the full target M1 candle", () => {
  assert.equal(isSignalEntryWindow(candle, openAt), true);
  assert.equal(isSignalEntryWindow(candle, openAt + 1000), true);
  assert.equal(isSignalEntryWindow(candle, openAt + 5000), true);
  assert.equal(isSignalEntryWindow(candle, openAt + 59999), true);
  assert.equal(isSignalEntryWindow(candle, openAt - 1), false);
  assert.equal(isSignalEntryWindow(candle, openAt + 60001), false);
  assert.equal(isSignalEntryWindow(candle + 60, openAt + 5000), false);
});

test("entry dispatch requires a Streaming tick no older than five seconds", () => {
  assert.equal(isFreshSignalTick(openAt + 4000, openAt + 4000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5001), false);
  assert.equal(isFreshSignalTick(openAt + 1, openAt), false);
});

test("per-target-candle dedupe blocks repeats without suppressing the next candle", () => {
  const now = openAt + 3000;
  const base = { candleEpoch: candle, tickAt: now - 1000, now };
  assert.equal(canDispatchSignal(base), true);
  assert.equal(canDispatchSignal({ ...base, lastDispatchedCandle: candle }), false);
  assert.equal(canDispatchSignal({ ...base, lastDispatchedAt: now - 1000 }), true);
  assert.equal(canDispatchSignal({ ...base, candleEpoch: candle + 60, lastDispatchedCandle: candle, lastDispatchedAt: now - 1000 }), true);
});
