import test from "node:test";
import assert from "node:assert/strict";
import { createNextCandleSignal, canDispatchNextCandleSignal } from "../src/next-candle-timing.js";

test("signal targets exactly the following M1 candle and expires 30 seconds after its open", () => {
  const source = 1_800_000_000;
  const now = source * 1000 + 45_000;
  const signal = createNextCandleSignal({ signal: "CALL", sourceCandleEpoch: source, now, entryPrice: 1.08 });
  assert.equal(signal.targetCandleEpoch, source + 60);
  assert.equal(signal.targetOpensAt, (source + 60) * 1000);
  assert.equal(signal.expiresAt, (source + 60) * 1000 + 30_000);
});

test("signal cannot be created after the target candle has opened", () => {
  const source = 1_800_000_000;
  assert.equal(createNextCandleSignal({ signal: "PUT", sourceCandleEpoch: source, now: (source + 60) * 1000 }), null);
});

test("dispatch is fresh, pre-expiry and deduplicated by target candle", () => {
  const source = 1_800_000_000, now = source * 1000 + 55_000;
  const active = createNextCandleSignal({ signal: "PUT", sourceCandleEpoch: source, now });
  assert.equal(canDispatchNextCandleSignal(active, { now, tickAt: now - 1000 }), true);
  assert.equal(canDispatchNextCandleSignal(active, { now, tickAt: now - 6000 }), false);
  assert.equal(canDispatchNextCandleSignal(active, { now, tickAt: now - 1000, lastDispatchedTargetCandle: source + 60 }), false);
  assert.equal(canDispatchNextCandleSignal(active, { now: active.expiresAt, tickAt: active.expiresAt }), false);
});
