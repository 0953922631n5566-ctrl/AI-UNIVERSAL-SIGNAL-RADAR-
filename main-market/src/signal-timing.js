export const SIGNAL_ENTRY_WINDOW_MAX_MS = 5000;
export const SIGNAL_DISPATCH_COOLDOWN_MS = 55000;
export const SIGNAL_MAX_TICK_AGE_MS = 5000;

// The forecast is for the candle that has just opened. Only the first five
// seconds are eligible; late results are discarded rather than backdated.
export function isSignalEntryWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const elapsed = now - candleEpoch * 1000;
  return elapsed >= 0 && elapsed <= SIGNAL_ENTRY_WINDOW_MAX_MS;
}

export function isFreshSignalTick(tickAt, now = Date.now()) {
  return Number.isFinite(tickAt) && Number.isFinite(now) &&
    tickAt <= now && now - tickAt <= SIGNAL_MAX_TICK_AGE_MS;
}

export function canDispatchSignal({ candleEpoch, tickAt, now = Date.now(),
  lastDispatchedAt = 0, lastDispatchedCandle = null } = {}) {
  const cooldownElapsed = !lastDispatchedAt ||
    now - lastDispatchedAt >= SIGNAL_DISPATCH_COOLDOWN_MS;
  return isSignalEntryWindow(candleEpoch, now) &&
    isFreshSignalTick(tickAt, now) &&
    lastDispatchedCandle !== candleEpoch &&
    cooldownElapsed;
}
