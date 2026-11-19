import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEarlyEntryEngine4, ENGINE4_ENTRY_WINDOW_MS } from "../src/engine-four.js";
import { isEngine4EntryWindow, canDispatchEngine4Signal } from "../src/signal-timing.js";

const epoch = 1_800_000_060;
const history = Array.from({length:20}, (_, i) => {
  const close = 1.1000 + i * 0.0001;
  return { epoch:epoch - (20-i)*60, open:close-0.00005, close,
    high:close+0.0001, low:close-0.0001, live:false, provisional:false };
});
const liveCall = { epoch, open:1.1018, close:1.1019, high:1.1020, low:1.1017, live:false, provisional:true };
const livePut = { epoch, open:1.1001, close:1.1000, high:1.1002, low:1.0999, live:false, provisional:true };
function analyze(live = liveCall, elapsed = 5, candles = history) {
  return analyzeEarlyEntryEngine4([...candles, live], {
    livePreview:true, now:epoch*1000+elapsed*1000, currentPrice:live.close
  });
}
test("Engine 4 emits CALL on EMA2>EMA3 pullback to EMA2 with live price above open", () => {
  const out=analyze(liveCall);
  assert.equal(out.signal,"CALL");
  assert.equal(out.status,"EMA2_3_PULLBACK_CALL");
  assert.ok(out.metrics.ema2 > out.metrics.ema3);
  assert.equal(out.metrics.emaFastPeriod,2);
  assert.equal(out.metrics.emaSlowPeriod,3);
});
test("Engine 4 emits PUT on EMA2<EMA3 pullback to EMA2 with live price below open", () => {
  const falling = Array.from({length:20}, (_, i) => {
    const close = 1.1020 - i * 0.0001;
    return { epoch:epoch - (20-i)*60, open:close+0.00005, close,
      high:close+0.0001, low:close-0.0001, live:false, provisional:false };
  });
  const out=analyze(livePut,5,falling);
  assert.equal(out.signal,"PUT");
  assert.equal(out.status,"EMA2_3_PULLBACK_PUT");
  assert.ok(out.metrics.ema2 < out.metrics.ema3);
});
test("Engine 4 waits when EMA pullback conditions are not met", () => {
  const noTouch={...liveCall,open:1.10215,close:1.1022,high:1.1023,low:1.10215};
  const out=analyze(noTouch);
  assert.equal(out.signal,null);
  assert.equal(out.status,"WAITING_FOR_PULLBACK");
});
test("Engine 4 requires at least three valid closed candles for EMA history", () => {
  const out=analyze(liveCall,5,history.slice(0,2));
  assert.equal(out.ready,false);
  assert.equal(out.status,"INSUFFICIENT_EMA_HISTORY");
});
test("Engine 4 does not signal after the first 23 seconds", () => {
  const out=analyze(liveCall,23);
  assert.equal(out.signal,null);
  assert.equal(out.status,"PULLBACK_WINDOW_CLOSED");
});
test("Engine 4 requires a fresh forming candle preview", () => {
  const out=analyzeEarlyEntryEngine4([...history,{...liveCall,provisional:false}],{livePreview:false,now:epoch*1000+5000});
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
