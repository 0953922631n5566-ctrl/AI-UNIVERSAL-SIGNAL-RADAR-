import test from "node:test";
import assert from "node:assert/strict";
import {
  canFinalizeSignal, isFreshSignalTick, isPrepareAlertWindow,
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

test("CALL/PUT finalization is allowed only during the first five seconds after M1 opens", () => {
  assert.equal(isSignalFinalizeWindow(candle, openAt - 1), false);
  assert.equal(isSignalFinalizeWindow(candle, openAt), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 4_999), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 5_000), false);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 59_999), false);
});

test("finalization requires a fresh Streaming tick and deduplicates each source candle", () => {
  const now = openAt + 2_000;
  const base = { candleEpoch: candle, tickAt: now - 1_000, now };
  assert.equal(canFinalizeSignal(base), true);
  assert.equal(canFinalizeSignal({ ...base, lastDispatchedCandle: candle }), false);
  assert.equal(canFinalizeSignal({ ...base, tickAt: now - 5_001 }), false);
  assert.equal(canFinalizeSignal({ ...base, now: openAt + 5_000 }), false);
});

test("Streaming tick freshness is limited to five seconds", () => {
  assert.equal(isFreshSignalTick(openAt + 4_000, openAt + 4_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_001), false);
  assert.equal(isFreshSignalTick(openAt + 1, openAt), false);
});

test("signal expires exactly 30 seconds after the current M1 candle opens", () => {
  assert.equal(signalHoldExpiresAt(candle), openAt + 30_000);
});

test("uses provider event time for the opening lock while still requiring a fresh receipt tick", () => {
  const now = openAt + 7_000;
  const base = { candleEpoch: candle, tickAt: now - 500, tickEventAt: openAt + 4_000, now };
  assert.equal(canFinalizeSignal(base), true);
  assert.equal(canFinalizeSignal({ ...base, tickEventAt: openAt + 5_000 }), false);
  assert.equal(canFinalizeSignal({ ...base, tickAt: now - 5_001 }), false);
});
