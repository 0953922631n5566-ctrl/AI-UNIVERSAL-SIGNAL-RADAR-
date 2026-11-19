import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_ENTRY_WINDOW_MS } from "../src/engine-four.js";
import { isEngine4EntryWindow, canDispatchEngine4Signal } from "../src/signal-timing.js";

const epoch = 1_800_000_060;
const live = { epoch, open:1.1, high:1.1002, low:1.0998, close:1.1, live:false, provisional:true };
function stats(overrides = {}) {
  return { candleEpoch:epoch, firstPrice:1.1, previousPrice:1.1002,
    initialDirection:"UP", extremePrice:1.1002, reversalSignal:null, reversalPrice:null,
    upTicks:1, downTicks:0, totalTicks:2, ...overrides };
}
function analyze(tickStats = stats(), elapsed = 5) {
  return analyzeEarlyEntryEngine4([live], {
    livePreview:true, now:epoch*1000+elapsed*1000,
    tickStats, currentPrice:tickStats.previousPrice
  });
}
test("Engine 4 emits CALL on the first downward tick after an upward price move", () => {
  const out=analyze(stats({reversalSignal:"CALL",reversalPrice:1.1001,previousPrice:1.1001}));
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"PRICE_ACTION_PULLBACK_CALL");
  assert.equal(out.metrics.priceOnly,true);
  assert.deepEqual(out.metrics.indicatorsUsed,[]);
  assert.equal(out.metrics.previousCandleUsed,false);
});
test("Engine 4 emits PUT on the first upward tick after a downward price move", () => {
  const out=analyze(stats({initialDirection:"DOWN",extremePrice:1.0998,reversalSignal:"PUT",
    reversalPrice:1.0999,previousPrice:1.0999,upTicks:1,downTicks:1}));
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"PRICE_ACTION_PULLBACK_PUT");
});
test("Engine 4 waits while price has not reversed", () => {
  const out=analyze(stats());
  assert.equal(out.signal,null);
  assert.equal(out.status,"WAITING_FOR_PRICE_REVERSAL");
});
test("Engine 4 waits for first live ticks and does not require closed candle history", () => {
  const out=analyze({candleEpoch:epoch,firstPrice:null,previousPrice:null});
  assert.equal(out.ready,true);
  assert.equal(out.status,"WAITING_FOR_PRICE_TICKS");
});
test("Engine 4 does not signal after the first 23 seconds", () => {
  const out=analyze(stats({reversalSignal:"CALL"}),23);
  assert.equal(out.signal,null);
  assert.equal(out.status,"PULLBACK_WINDOW_CLOSED");
});
test("Engine 4 requires a fresh forming candle preview", () => {
  const out=analyzeEarlyEntryEngine4([{...live,provisional:false}],{livePreview:false,now:epoch*1000+5000});
  assert.equal(out.ready,false);
  assert.equal(out.status,"NOT_READY");
});
test("Engine 4 timing opens immediately and closes at 23 seconds", () => {
  assert.equal(ENGINE4_ENTRY_WINDOW_MS,23_000);
  assert.equal(isEngine4EntryWindow(epoch,epoch*1000),true);
  assert.equal(isEngine4EntryWindow(epoch,epoch*1000+22_999),true);
  assert.equal(isEngine4EntryWindow(epoch,epoch*1000+23_000),false);
});
test("Engine 4 dispatch requires fresh streaming tick and one dispatch per candle", () => {
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000+500,now:epoch*1000+1000}),true);
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000+500,now:epoch*1000+1000,lastDispatchedCandle:epoch}),false);
  assert.equal(canDispatchEngine4Signal({candleEpoch:epoch,tickAt:epoch*1000-6000,now:epoch*1000+1000}),false);
});
