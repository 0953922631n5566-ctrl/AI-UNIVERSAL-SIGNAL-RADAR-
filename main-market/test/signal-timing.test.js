import test from "node:test";
import assert from "node:assert/strict";
import {canDispatchEngine4Signal,canFinalizeSignal,isEngine4EntryWindow,isFreshSignalTick,isPrepareAlertWindow,isSignalFinalizeWindow,signalHoldExpiresAt} from "../src/signal-timing.js";
const candle=1_800_000_000,openAt=candle*1000;
test("PREPARE window is T-10 through just before T-5",()=>{
 assert.equal(isPrepareAlertWindow(candle,openAt+49999),false);
 assert.equal(isPrepareAlertWindow(candle,openAt+50000),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+54999),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+55000),false);});
test("all engines finalize CALL/PUT only in the final five seconds",()=>{
 assert.equal(isSignalFinalizeWindow(candle,openAt+54999),false);
 assert.equal(isSignalFinalizeWindow(candle,openAt+55000),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+59999),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+60000),false);
 assert.equal(isEngine4EntryWindow(candle,openAt+54999),false);
 assert.equal(isEngine4EntryWindow(candle,openAt+55000),true);});
test("finalization requires a fresh tick and one dispatch per candle",()=>{
 const now=openAt+55000,base={candleEpoch:candle,tickAt:now-1000,now};
 assert.equal(canFinalizeSignal(base),true);assert.equal(canDispatchEngine4Signal(base),true);
 assert.equal(canFinalizeSignal({...base,lastDispatchedCandle:candle}),false);
 assert.equal(canDispatchEngine4Signal({...base,lastDispatchedCandle:candle}),false);
 assert.equal(canFinalizeSignal({...base,tickAt:now-5001}),false);
 assert.equal(canFinalizeSignal({...base,now:openAt+60000}),false);});
test("tick freshness is limited to five seconds",()=>{
 assert.equal(isFreshSignalTick(openAt+4000,openAt+4000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5001),false);
 assert.equal(isFreshSignalTick(openAt+1,openAt),false);});
test("signal expires 30 seconds after target candle opens",()=>{
 assert.equal(signalHoldExpiresAt(candle+60),openAt+90000);});
test("Engine 4 accumulates through T-5 and dispatches in same final window",()=>{
 const t10=openAt+50000,t5=openAt+55000,later=openAt+59999;
 assert.equal(isEngine4EntryWindow(candle,t10),false);assert.equal(isEngine4EntryWindow(candle,t5),true);
 assert.equal(isEngine4EntryWindow(candle,later),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:t5-1000,now:t5}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:t5-6000,now:t5}),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:t5-1000,now:t5,lastDispatchedCandle:candle}),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:openAt+59000,now:openAt+60000}),false);});
