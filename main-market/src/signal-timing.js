export const M1_CANDLE_MS = 60_000;
export const PREPARE_ALERT_START_MS = 45_000;
export const SIGNAL_FINALIZE_START_MS = 50_000;
export const SIGNAL_HOLD_SECONDS = 30;
export const SIGNAL_MAX_TICK_AGE_MS = 5_000;

export function isPrepareAlertWindow(epoch, now = Date.now()) {
  if (!Number.isFinite(epoch) || !Number.isFinite(now)) return false;
  const elapsed = now - epoch * 1000;
  return elapsed >= PREPARE_ALERT_START_MS && elapsed < SIGNAL_FINALIZE_START_MS;
}
export function isSignalFinalizeWindow(epoch, now = Date.now()) {
  if (!Number.isFinite(epoch) || !Number.isFinite(now)) return false;
  const elapsed = now - epoch * 1000;
  return elapsed >= SIGNAL_FINALIZE_START_MS && elapsed < M1_CANDLE_MS;
}
export function signalHoldExpiresAt(epoch) {
  return Number.isFinite(epoch) ? epoch * 1000 + SIGNAL_HOLD_SECONDS * 1000 : null;
}
export function isFreshSignalTick(tickAt, now = Date.now()) {
  return Number.isFinite(tickAt) && Number.isFinite(now) &&
    tickAt <= now && now - tickAt <= SIGNAL_MAX_TICK_AGE_MS;
}
export function canFinalizeSignal({ candleEpoch, tickAt, now = Date.now(), lastDispatchedCandle = null } = {}) {
  return isSignalFinalizeWindow(candleEpoch, now) &&
    isFreshSignalTick(tickAt, now) && lastDispatchedCandle !== candleEpoch;
}

/** Permit an immediate intrabar signal once a fresh Twelve Data tick confirms the live M1 entry. */
export function canTriggerLiveSignal({ candleEpoch, tickAt, now = Date.now(), lastDispatchedCandle = null } = {}) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= 0 && elapsed < M1_CANDLE_MS &&
    isFreshSignalTick(tickAt, now) && lastDispatchedCandle !== candleEpoch;
}
