import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeEarlyEntryEngine4, ENGINE4_COLLECTION_WINDOW_MS,
  ENGINE4_DECISION_AT_MS, ENGINE4_ENTRY_WINDOW_MS
} from "../src/engine-four.js";

const epoch = 1_800_000_060;
const closedUp = [
  { epoch: epoch - 120, open: 1.1000, close: 1.1002, high: 1.1003, low: 1.0999, live: false },
  { epoch: epoch - 60, open: 1.1002, close: 1.1004, high: 1.1005, low: 1.1001, live: false }
];
const live = {
  epoch, open: 1.1004, close: 1.10045, high: 1.1005, low: 1.1003,
  live: false, provisional: true
};
function stats(upMovement = 0.00005, downMovement = 0.00001, recentDirection = "UP") {
  const now = epoch * 1000 + 23_000;
  return {
    candleEpoch: epoch, firstPrice: live.open, previousPrice: live.close,
    upMovement, downMovement, totalTicks: 20,
    recentSamples: [
      { at: now - 4_000, price: 1.1005 },
      { at: now - 1_000, price: recentDirection === "DOWN" ? 1.10045 : 1.10055 }
    ]
  };
}
function analyze({
  candles = closedUp, current = live, tickStats = stats(),
  elapsed = 23, currentPrice = current.close
} = {}) {
  return analyzeEarlyEntryEngine4([...candles, current], {
    livePreview: true, now: epoch * 1000 + elapsed * 1000,
    tickStats, currentPrice
  });
}

test("Engine 4 waits until second 23 while collecting the two closed candles and live tick path", () => {
  const out = analyze({ elapsed: 22 });
  assert.equal(out.ready, true);
  assert.equal(out.decisionMade, false);
  assert.equal(out.signal, null);
  assert.equal(out.status, "COLLECTING_PRICE_PRESSURE");
});
test("Engine 4 emits CALL when accumulated upward movement is greater", () => {
  const out = analyze();
  assert.equal(out.signal, "CALL");
  assert.equal(out.status, "ACCUMULATED_PRESSURE_CALL");
  assert.equal(out.decisionMade, true);
  assert.ok(out.metrics.totalUpMovement > out.metrics.totalDownMovement);
  assert.equal(out.metrics.closedCandlesUsed.length, 2);
});
test("Engine 4 emits PUT when accumulated downward movement is greater", () => {
  const falling = [
    { epoch: epoch - 120, open: 1.1010, close: 1.1008, high: 1.1011, low: 1.1007, live: false },
    { epoch: epoch - 60, open: 1.1008, close: 1.1006, high: 1.1009, low: 1.1005, live: false }
  ];
  const out = analyze({ candles: falling, current: { ...live, open: 1.1006, close: 1.10055 },
    tickStats: stats(0.00001, 0.00005, "DOWN") });
  assert.equal(out.signal, "PUT");
  assert.equal(out.status, "ACCUMULATED_PRESSURE_PUT");
  assert.ok(out.metrics.totalDownMovement > out.metrics.totalUpMovement);
});
test("last five seconds are continuation context only and cannot reverse the accumulated direction", () => {
  const out = analyze({ tickStats: stats(0.00005, 0.00001, "DOWN") });
  assert.equal(out.signal, "CALL");
  assert.equal(out.metrics.continuationDirection, "DOWN");
  assert.equal(out.metrics.continuationSupportsDominant, false);
  assert.match(out.reason, /ไม่เปลี่ยนทิศทางแรงสะสมหลัก/);
});
test("Engine 4 does not signal when accumulated upward and downward movement tie", () => {
  const balanced = [
    { epoch: epoch - 120, open: 1.1000, close: 1.1002, high: 1.1003, low: 1.0999, live: false },
    { epoch: epoch - 60, open: 1.1002, close: 1.1000, high: 1.1003, low: 1.0999, live: false }
  ];
  const out = analyze({ candles: balanced, tickStats: stats(0.00002, 0.00002) });
  assert.equal(out.signal, null);
  assert.equal(out.decisionMade, true);
  assert.equal(out.status, "ACCUMULATED_PRESSURE_TIE");
});
test("Engine 4 requires exactly two valid closed candles", () => {
  const out = analyze({ candles: closedUp.slice(1) });
  assert.equal(out.ready, false);
  assert.equal(out.status, "INSUFFICIENT_CLOSED_CANDLES");
});
test("Engine 4 requires the live tick path for the current candle", () => {
  const out = analyze({ tickStats: null });
  assert.equal(out.ready, false);
  assert.equal(out.status, "LIVE_TICK_PATH_NOT_READY");
});
test("Engine 4 requires a fresh forming candle preview", () => {
  const out = analyze({ current: { ...live, provisional: false, live: false } });
  assert.equal(out.ready, false);
  assert.equal(out.status, "NOT_READY");
});
test("Engine 4 does not make a decision before the 23-second deadline", () => {
  assert.equal(ENGINE4_COLLECTION_WINDOW_MS, 23_000);
  assert.equal(ENGINE4_DECISION_AT_MS, 23_000);
  assert.equal(ENGINE4_ENTRY_WINDOW_MS, 60_000);
  assert.equal(analyze({ elapsed: 22.999 }).decisionMade, false);
  assert.equal(analyze({ elapsed: 23 }).decisionMade, true);
});
