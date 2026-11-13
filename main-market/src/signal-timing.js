export const M1_CANDLE_MS = 60_000;
export const PREPARE_ALERT_START_MS = 50_000;
export const SIGNAL_FINALIZE_START_MS = 55_000;
export const SIGNAL_HOLD_SECONDS = 30;
export const SIGNAL_MAX_TICK_AGE_MS = 5_000;

export function isPrepareAlertWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= PREPARE_ALERT_START_MS && elapsed < SIGNAL_FINALIZE_START_MS;
}

export function isSignalFinalizeWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= 0 && elapsed < M1_CANDLE_MS;
}

export function signalHoldExpiresAt(_candleEpoch, triggeredAt = Date.now()) {
  if (!Number.isFinite(triggeredAt)) return null;
  return triggeredAt + SIGNAL_HOLD_SECONDS * 1000;
}

export function isFreshSignalTick(tickAt, now = Date.now()) {
  return Number.isFinite(tickAt) && Number.isFinite(now) && tickAt <= now && now - tickAt <= SIGNAL_MAX_TICK_AGE_MS;
}

export function isFreshEventTimestamp(eventAt, now = Date.now()) {
  return Number.isFinite(eventAt) && Number.isFinite(now) && eventAt <= now && now - eventAt <= SIGNAL_MAX_TICK_AGE_MS;
}

export function canFinalizeSignal({ candleEpoch, tickAt, tickEventAt, now = Date.now() } = {}) {
  const eventAt = Number.isFinite(tickEventAt) ? tickEventAt : now;
  const elapsed = eventAt - candleEpoch * 1000;
  return Number.isFinite(candleEpoch) && elapsed >= 0 && elapsed < M1_CANDLE_MS &&
    isFreshSignalTick(tickAt, now) && isFreshEventTimestamp(eventAt, now);
}
