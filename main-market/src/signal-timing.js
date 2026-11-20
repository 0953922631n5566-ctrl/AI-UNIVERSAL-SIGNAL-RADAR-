export const M1_CANDLE_MS=60_000;
export const PREPARE_ALERT_START_MS=50_000;
export const SIGNAL_FINALIZE_START_MS=55_000;
export const SIGNAL_HOLD_SECONDS=30;
export const SIGNAL_MAX_TICK_AGE_MS=5_000;
export const ENGINE4_COLLECTION_WINDOW_MS=PREPARE_ALERT_START_MS;
export const ENGINE4_DECISION_AT_MS=SIGNAL_FINALIZE_START_MS;
export const ENGINE4_ENTRY_WINDOW_MS=M1_CANDLE_MS;
export function isPrepareAlertWindow(epoch,now=Date.now()){
 if(!Number.isFinite(epoch)||!Number.isFinite(now))return false;
 const elapsed=now-epoch*1000;return elapsed>=PREPARE_ALERT_START_MS&&elapsed<SIGNAL_FINALIZE_START_MS;
}
export function isSignalFinalizeWindow(epoch,now=Date.now()){
 if(!Number.isFinite(epoch)||!Number.isFinite(now))return false;
 const elapsed=now-epoch*1000;return elapsed>=SIGNAL_FINALIZE_START_MS&&elapsed<M1_CANDLE_MS;
}
export function isEngine4EntryWindow(epoch,now=Date.now()){return isSignalFinalizeWindow(epoch,now);}
export function signalHoldExpiresAt(epoch){return Number.isFinite(epoch)?epoch*1000+SIGNAL_HOLD_SECONDS*1000:null;}
export function isFreshSignalTick(tickAt,now=Date.now()){
 return Number.isFinite(tickAt)&&Number.isFinite(now)&&tickAt<=now&&now-tickAt<=SIGNAL_MAX_TICK_AGE_MS;
}
export function canFinalizeSignal({candleEpoch,tickAt,now=Date.now(),lastDispatchedCandle=null}={}){
 return isSignalFinalizeWindow(candleEpoch,now)&&isFreshSignalTick(tickAt,now)&&lastDispatchedCandle!==candleEpoch;
}
export function canDispatchEngine4Signal({candleEpoch,tickAt,now=Date.now(),lastDispatchedCandle=null}={}){
 return isEngine4EntryWindow(candleEpoch,now)&&isFreshSignalTick(tickAt,now)&&lastDispatchedCandle!==candleEpoch;
}
