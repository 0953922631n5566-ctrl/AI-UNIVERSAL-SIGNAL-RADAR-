import test from "node:test";
import assert from "node:assert/strict";
import {canDispatchEngine4Signal,canFinalizeSignal,isEngine4EntryWindow,isFreshSignalTick,isPrepareAlertWindow,isSignalFinalizeWindow,signalHoldExpiresAt} from "../src/signal-timing.js";
const candle=1_800_000_000,openAt=candle*1000;
test("PREPARE window is T-10 through just before T-5",()=>{
 assert.equal(isPrepareAlertWindow(candle,openAt+49999),false);
 assert.equal(isPrepareAlertWindow(candle,openAt+50000),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+54999),true);
 assert.equal(isPrepareAlertWindow(candle,openAt+55000),false);});
test("Engines 1-3 finalize in the final five seconds while Engine 4 forecasts at next M1 open",()=>{
 assert.equal(isSignalFinalizeWindow(candle,openAt+54999),false);
 assert.equal(isSignalFinalizeWindow(candle,openAt+55000),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+59999),true);
 assert.equal(isSignalFinalizeWindow(candle,openAt+60000),false);
 assert.equal(isEngine4EntryWindow(candle,openAt),true);
 assert.equal(isEngine4EntryWindow(candle,openAt+4999),true);
 assert.equal(isEngine4EntryWindow(candle,openAt+5000),false);
 assert.equal(isEngine4EntryWindow(candle,openAt+54999),false);});
test("finalization and Engine 4 dispatch each require a fresh tick and allow one dispatch per candle",()=>{
 const finalNow=openAt+55000,finalBase={candleEpoch:candle,tickAt:finalNow-1000,now:finalNow};
 assert.equal(canFinalizeSignal(finalBase),true);
 assert.equal(canDispatchEngine4Signal(finalBase),false);
 assert.equal(canFinalizeSignal({...finalBase,lastDispatchedCandle:candle}),false);
 assert.equal(canFinalizeSignal({...finalBase,tickAt:finalNow-5001}),false);
 assert.equal(canFinalizeSignal({...finalBase,now:openAt+60000}),false);
 const engine4Now=openAt+1000,engine4Base={candleEpoch:candle,tickAt:openAt,now:engine4Now};
 assert.equal(canDispatchEngine4Signal(engine4Base),true);
 assert.equal(canDispatchEngine4Signal({...engine4Base,lastDispatchedCandle:candle}),false);
 assert.equal(canDispatchEngine4Signal({...engine4Base,tickAt:openAt-5001}),false);});
test("tick freshness is limited to five seconds",()=>{
 assert.equal(isFreshSignalTick(openAt+4000,openAt+4000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5000),true);
 assert.equal(isFreshSignalTick(openAt,openAt+5001),false);
 assert.equal(isFreshSignalTick(openAt+1,openAt),false);});
test("signal expires 30 seconds after target candle opens",()=>{
 assert.equal(signalHoldExpiresAt(candle+60),openAt+90000);});
test("Engine 4 dispatches once in the first five seconds of the target M1 candle, never at T-5",()=>{
 const opening=openAt,firstWindowEnd=openAt+4999,afterWindow=openAt+5000,t5=openAt+55000;
 assert.equal(isEngine4EntryWindow(candle,opening),true);
 assert.equal(isEngine4EntryWindow(candle,firstWindowEnd),true);
 assert.equal(isEngine4EntryWindow(candle,afterWindow),false);
 assert.equal(isEngine4EntryWindow(candle,t5),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:opening,now:opening+1000}),true);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:opening,lastDispatchedCandle:candle,now:opening+1000}),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:opening,now:opening+6000}),false);
 assert.equal(canDispatchEngine4Signal({candleEpoch:candle,tickAt:opening+59000,now:openAt+60000}),false);});
