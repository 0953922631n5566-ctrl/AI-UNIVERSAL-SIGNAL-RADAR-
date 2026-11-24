import test from "node:test";
import assert from "node:assert/strict";
import { canFinalizeSignal, canTriggerLiveSignal, isFreshSignalTick, isPrepareAlertWindow,
  isSignalFinalizeWindow, signalHoldExpiresAt } from "../src/signal-timing.js";
const candle = 1_800_000_000, openAt = candle * 1000;

test("legacy T-15/T-10 timing helpers remain isolated and deterministic", () => {
  assert.equal(isPrepareAlertWindow(candle, openAt + 45000), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 50000), true);
  assert.equal(canFinalizeSignal({ candleEpoch: candle, tickAt: openAt + 50000, now: openAt + 50000 }), true);
});
test("fresh Streaming tick is limited to five seconds", () => {
  assert.equal(isFreshSignalTick(openAt + 4000, openAt + 4000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5001), false);
  assert.equal(isFreshSignalTick(openAt + 1, openAt), false);
});
test("instant entry can trigger at any point in the current M1 candle", () => {
  for (const elapsed of [1000, 15000, 30000, 49999, 59000]) {
    const now = openAt + elapsed;
    assert.equal(canTriggerLiveSignal({ candleEpoch: candle, tickAt: now - 500, now }), true);
  }
});
test("instant entry still requires a fresh tick, current candle, and one signal per candle", () => {
  const now = openAt + 20000;
  const base = { candleEpoch: candle, tickAt: now, now };
  assert.equal(canTriggerLiveSignal(base), true);
  assert.equal(canTriggerLiveSignal({ ...base, tickAt: now - 5001 }), false);
  assert.equal(canTriggerLiveSignal({ ...base, lastDispatchedCandle: candle }), false);
  assert.equal(canTriggerLiveSignal({ ...base, now: openAt + 60000 }), false);
});
test("signal hold helper remains 30 seconds from a supplied epoch", () => {
  assert.equal(signalHoldExpiresAt(candle + 60), openAt + 90000);
});
