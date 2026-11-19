import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_ENTRY_WINDOW_MS } from "../src/engine-four.js";
import { isEngine4EntryWindow, canDispatchEngine4Signal } from "../src/signal-timing.js";

const epoch = 1_800_000_060;
function candle(offset, open, close, high, low) {
  return { epoch: epoch + offset * 60, open, close, high, low, live: false };
}
function fixture({ direction = "up", elapsed = 5, touch = true, confirm = true } = {}) {
  const history = Array.from({length:20}, (_, i) => {
    const close = direction === "up" ? 1.1000 + i * 0.0001 : 1.1020 - i * 0.0001;
    return candle(i - 20, close - (direction === "up" ? 0.00005 : -0.00005), close,
      close + 0.0001, close - 0.0001);
  });
  const fast = direction === "up" ? 1.1016 : 1.1004;
  const live = { epoch, open: confirm ? fast - (direction === "up" ? 0.00005 : -0.00005) : fast,
    close: confirm ? fast + (direction === "up" ? 0.00005 : -0.00005) : fast,
    high: fast + 0.0002, low: touch ? fast - 0.0002 : fast + 0.00005,
    live: false, provisional: true };
  if (direction === "down") {
    live.high = touch ? fast + 0.0002 : fast - 0.00005;
    live.low = fast - 0.0002;
  }
  return { history, live, now: epoch * 1000 + elapsed * 1000 };
}
test("Engine 4 emits CALL immediately on an uptrend EMA5 pullback and bullish turn", () => {
  const f = fixture();
  const out = analyzeEarlyEntryEngine4([...f.history, f.live], { livePreview:true, now:f.now, currentPrice:f.live.close });
  assert.equal(out.signal, "CALL");
  assert.equal(out.status, "EMA5_13_PULLBACK_CALL");
  assert.equal(out.metrics.uptrend, true);
  assert.ok(out.elapsedSeconds < 23);
});
test("Engine 4 emits PUT immediately on a downtrend EMA5 pullback and bearish turn", () => {
  const f = fixture({direction:"down"});
  const out = analyzeEarlyEntryEngine4([...f.history, f.live], { livePreview:true, now:f.now });
  assert.equal(out.signal, "PUT");
  assert.equal(out.status, "EMA5_13_PULLBACK_PUT");
});
test("Engine 4 waits if trend direction and pullback confirmation do not align", () => {
  const f = fixture({touch:false});
  const out = analyzeEarlyEntryEngine4([...f.history, f.live], { livePreview:true, now:f.now });
  assert.equal(out.signal, null);
  assert.equal(out.status, "WAITING_FOR_PULLBACK");
});
test("Engine 4 does not signal after the first 23 seconds", () => {
  const f = fixture({elapsed:23});
  const out = analyzeEarlyEntryEngine4([...f.history, f.live], { livePreview:true, now:f.now });
  assert.equal(out.signal, null);
  assert.equal(out.status, "PULLBACK_WINDOW_CLOSED");
});
test("Engine 4 requires at least 13 closed candles for EMA13", () => {
  const f = fixture();
  const out = analyzeEarlyEntryEngine4([f.live], { livePreview:true, now:f.now });
  assert.equal(out.ready, false);
  assert.equal(out.status, "INSUFFICIENT_EMA_HISTORY");
});
test("Engine 4 requires a fresh forming candle preview", () => {
  const f = fixture();
  const out = analyzeEarlyEntryEngine4([...f.history, {...f.live, provisional:false}], { livePreview:false, now:f.now });
  assert.equal(out.ready, false);
  assert.equal(out.status, "NOT_READY");
});
test("Engine 4 timing opens immediately and closes at 23 seconds", () => {
  assert.equal(ENGINE4_ENTRY_WINDOW_MS, 23_000);
  assert.equal(isEngine4EntryWindow(epoch, epoch * 1000), true);
  assert.equal(isEngine4EntryWindow(epoch, epoch * 1000 + 22_999), true);
  assert.equal(isEngine4EntryWindow(epoch, epoch * 1000 + 23_000), false);
});
test("Engine 4 dispatch requires fresh streaming tick and one dispatch per candle", () => {
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000+500,now:epoch*1000+1000}), true);
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000+500,now:epoch*1000+1000,lastDispatchedCandle:epoch}), false);
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000-6000,now:epoch*1000+1000}), false);
});
