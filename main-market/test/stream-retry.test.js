import test from "node:test";
import assert from "node:assert/strict";
import { getStreamRetryReason } from "../src/stream-retry.js";

test("reconnects when a subscribed pair never receives its first live tick", () => {
  assert.equal(getStreamRetryReason({
    monitoring: true, selectedSymbol: "AUD/USD", feedSymbol: "AUD/USD",
    tickAt: 0, streamStatus: "SUBSCRIBED", subscribeAt: 10_000, now: 36_000
  }), "FIRST_TICK_TIMEOUT");
});

test("reconnects when a previously live pair stops updating", () => {
  assert.equal(getStreamRetryReason({
    monitoring: true, selectedSymbol: "GBP/JPY", feedSymbol: "GBP/JPY",
    tickAt: 10_000, streamStatus: "READY", subscribeAt: 1_000, now: 36_000,
    maxStreamAgeMs: 25_000
  }), "STALE_TICK");
});

test("does not reconnect a healthy stream or a non-selected pair", () => {
  assert.equal(getStreamRetryReason({
    monitoring: true, selectedSymbol: "EUR/USD", feedSymbol: "EUR/USD",
    tickAt: 20_000, streamStatus: "READY", subscribeAt: 10_000, now: 24_000
  }), null);
  assert.equal(getStreamRetryReason({
    monitoring: true, selectedSymbol: "EUR/USD", feedSymbol: "AUD/USD",
    tickAt: 0, streamStatus: "SUBSCRIBED", subscribeAt: 1_000, now: 40_000
  }), null);
  assert.equal(getStreamRetryReason({
    monitoring: false, selectedSymbol: "AUD/USD", feedSymbol: "AUD/USD",
    tickAt: 0, streamStatus: "SUBSCRIBED", subscribeAt: 1_000, now: 40_000
  }), null);
});
