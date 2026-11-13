import test from "node:test";
import assert from "node:assert/strict";
import { canFinalizeSignal, isFreshEventTimestamp, isFreshSignalTick, isPrepareAlertWindow, isSignalFinalizeWindow, signalHoldExpiresAt } from "../src/signal-timing.js";

const candle = 1_800_000_000;
const openAt = candle * 1000;

test("PREPARE_ALERT remains a non-directional final-ten-second window", () => {
  assert.equal(isPrepareAlertWindow(candle, openAt + 49_999), false);
  assert.equal(isPrepareAlertWindow(candle, openAt + 50_000), true);
  assert.equal(isPrepareAlertWindow(candle, openAt + 54_999), true);
  assert.equal(isPrepareAlertWindow(candle, openAt + 55_000), false);
});

test("directional release is permitted throughout the live M1 candle", () => {
  assert.equal(isSignalFinalizeWindow(candle, openAt - 1), false);
  assert.equal(isSignalFinalizeWindow(candle, openAt), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 29_999), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 59_999), true);
  assert.equal(isSignalFinalizeWindow(candle, openAt + 60_000), false);
});

test("release requires fresh provider event and receipt timestamps", () => {
  const now = openAt + 42_000;
  const base = { candleEpoch: candle, tickAt: now - 500, tickEventAt: now - 500, now };
  assert.equal(canFinalizeSignal(base), true);
  assert.equal(canFinalizeSignal({ ...base, tickAt: now - 5_001 }), false);
  assert.equal(canFinalizeSignal({ ...base, tickEventAt: openAt + 1_000 }), true);
  assert.equal(canFinalizeSignal({ ...base, tickEventAt: openAt - 1 }), false);
  assert.equal(isFreshEventTimestamp(openAt + 1_000, now), true);
  assert.equal(canFinalizeSignal({ ...base, tickEventAt: openAt + 60_000 }), false);
});

test("streaming freshness remains capped at five seconds", () => {
  assert.equal(isFreshSignalTick(openAt + 4_000, openAt + 4_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_000), true);
  assert.equal(isFreshSignalTick(openAt, openAt + 5_001), false);
});

test("signal hold lasts 30 seconds after the target M1 candle opens", () => {
  const targetCandle = candle + 60;
  assert.equal(signalHoldExpiresAt(targetCandle), targetCandle * 1000 + 30_000);
  assert.equal(signalHoldExpiresAt(null), null);
});
