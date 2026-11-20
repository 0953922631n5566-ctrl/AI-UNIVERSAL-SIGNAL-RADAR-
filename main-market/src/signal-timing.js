export const M1_CANDLE_MS = 60_000;
export const PREPARE_ALERT_START_MS = 50_000;
export const SIGNAL_FINALIZE_START_MS = 55_000;
export const SIGNAL_HOLD_SECONDS = 30;
export const SIGNAL_MAX_TICK_AGE_MS = 5_000;
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DECISION_AT_MS = 23_000;
export const ENGINE4_ENTRY_WINDOW_MS = M1_CANDLE_MS;

export function isPrepareAlertWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= PREPARE_ALERT_START_MS && elapsed < SIGNAL_FINALIZE_START_MS;
}
export function isSignalFinalizeWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= SIGNAL_FINALIZE_START_MS && elapsed < M1_CANDLE_MS;
}
// Engine 4 decides once after collecting the first 23 seconds of the current M1 candle.
export function isEngine4EntryWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= ENGINE4_DECISION_AT_MS && elapsed < ENGINE4_ENTRY_WINDOW_MS;
}
export function signalHoldExpiresAt(targetCandleEpoch) {
  if (!Number.isFinite(targetCandleEpoch)) return null;
  return targetCandleEpoch * 1000 + SIGNAL_HOLD_SECONDS * 1000;
}
export function isFreshSignalTick(tickAt, now = Date.now()) {
  return Number.isFinite(tickAt) && Number.isFinite(now) && tickAt <= now && now - tickAt <= SIGNAL_MAX_TICK_AGE_MS;
}
export function canFinalizeSignal({ candleEpoch, tickAt, now = Date.now(), lastDispatchedCandle = null } = {}) {
  return isSignalFinalizeWindow(candleEpoch, now) && isFreshSignalTick(tickAt, now) && lastDispatchedCandle !== candleEpoch;
}
export function canDispatchEngine4Signal({ candleEpoch, tickAt, now = Date.now(), lastDispatchedCandle = null } = {}) {
  return isEngine4EntryWindow(candleEpoch, now) && isFreshSignalTick(tickAt, now) && lastDispatchedCandle !== candleEpoch;
}
