import test from "node:test";
import assert from "node:assert/strict";
import {
  canDispatchEngine4Signal, canFinalizeSignal, isEngine4EntryWindow, isFreshSignalTick, isPrepareAlertWindow,
  isSignalFinalizeWindow, signalHoldExpiresAt
} from "../src/signal-timing.js";

const candle = 1_800_000_000;
const openAt = candle * 1000;

test("PREPARE_ALERT is active only from T-10s until T-5s", () => {
  assert.equal(isPrepareAlertWindow(candle, openAt + 49_999), false);
  assert.equal(isPrepareAlertWindow(candle, openAt + 50_000), true);
  assert.equal(isPrepareAlertWindow(candle, openAt + 54_999), true);
  assert.equal(isPrepareAlertWindow(candle, openAt + 55_000), false);
  assert.equal(isPrepareAlertWindow(candle, openAt + 60_000), false);
});
test("CALL/PUT finalization for the other analyzers is allowed only during the final five seconds", () => {
  assert.equal(isSignalFinalizeWindow(candle, openAt + 54_999), false);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 55_000), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 59_999), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 60_000), false);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 54_000), false);
});
test("finalization requires a fresh Streaming tick and deduplicates each source candle", () => {
  const now = openAt + 55_000;
  const base = { candleEpoch: candle, tickAt: now - 1_000, now };
  assert.equal(canFinalizeSignal(base), true);
  assert.equal(canFinalizeSignal({ ...base, lastDispatchedCandle: candle }), false);
  assert.equal(canFinalizeSignal({ ...base, tickAt: now - 5_001 }), false);
  assert.equal(canFinalizeSignal({ ...base, now: openAt + 60_000 }), false);
});
test("Streaming tick freshness is limited to five seconds", () => {
  assert.equal(isFreshSignalTick(openAt + 4_000, openAt + 4_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_001), false);
  assert.equal(isFreshSignalTick(openAt + 1, openAt), false);
});
test("signal expires exactly 30 seconds after the target candle opens", () => {
  assert.equal(signalHoldExpiresAt(candle + 60), openAt + 90_000);
});
test("Engine 4 dispatches during seconds 0 through 22.999 and closes at 23 seconds", () => {
  const early = openAt + 2_000;
  const lastMoment = openAt + 22_999;
  const cutoff = openAt + 23_000;
  assert.equal(isEngine4EntryWindow(candle, openAt - 1), false);
  assert.equal(isEngine4EntryWindow(candle, openAt), true);
  assert.equal(isEngine4EntryWindow(candle, early), true);
  assert.equal(isEngine4EntryWindow(candle, lastMoment), true);
  assert.equal(isEngine4EntryWindow(candle, cutoff), false);
  assert.equal(isEngine4EntryWindow(candle, openAt + 29_999), false);
  assert.equal(isEngine4EntryWindow(candle, openAt + 30_000), false);
  assert.equal(isEngine4EntryWindow(candle, openAt + 59_999), false);
  assert.equal(isEngine4EntryWindow(candle, openAt + 60_000), false);
  assert.equal(canDispatchEngine4Signal({ candleEpoch: candle, tickAt: early - 1_000, now: early }), true);
  assert.equal(canDispatchEngine4Signal({ candleEpoch: candle, tickAt: early - 6_000, now: early }), false);
  assert.equal(canDispatchEngine4Signal({ candleEpoch: candle, tickAt: early - 1_000, now: early, lastDispatchedCandle: candle }), false);
  assert.equal(canDispatchEngine4Signal({ candleEpoch: candle, tickAt: lastMoment - 1_000, now: lastMoment }), true);
  assert.equal(canDispatchEngine4Signal({ candleEpoch: candle, tickAt: cutoff - 1_000, now: cutoff }), false);
});
