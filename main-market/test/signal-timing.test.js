import test from "node:test";
import assert from "node:assert/strict";
import {canFinalizeSignal,isFreshSignalTick,isPrepareAlertWindow,isSignalFinalizeWindow,signalHoldExpiresAt} from "../src/signal-timing.js";
const candle=1_800_000_000,openAt=candle*1000;
test("PREPARE window is T-15 through just before T-10",()=>{
 assert.equal(isPrepareAlertWindow(candle,openAt+44999),false);
 assert.equal(isPrepareAlertWindow(candle,openAt+45000),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+49999),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+50000),false);
});
test("Engine 3 finalizes only in the final ten seconds of the source M1 candle",()=>{
 assert.equal(isSignalFinalizeWindow(candle,openAt+49999),false);
 assert.equal(isSignalFinalizeWindow(candle,openAt+50000),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+59999),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+60000),false);
});
test("finalization requires a fresh Streaming tick and permits one dispatch per candle",()=>{
 const now=openAt+50000,base={candleEpoch:candle,tickAt:now-1000,now};
 assert.equal(canFinalizeSignal(base),true);
 assert.equal(canFinalizeSignal({...base,lastDispatchedCandle:candle}),false);
 assert.equal(canFinalizeSignal({...base,tickAt:now-5001}),false);
 assert.equal(canFinalizeSignal({...base,now:openAt+60000}),false);
});
test("tick freshness is limited to five seconds",()=>{
 assert.equal(isFreshSignalTick(openAt+4000,openAt+4000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5001),false);
 assert.equal(isFreshSignalTick(openAt+1,openAt),false);
});
test("signal expires 30 seconds after the target candle opens",()=>{
 assert.equal(signalHoldExpiresAt(candle+60),openAt+90000);
});
