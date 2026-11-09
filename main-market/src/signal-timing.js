export const SIGNAL_ENTRY_WINDOW_MAX_MS = 60000;
export const SIGNAL_DISPATCH_COOLDOWN_MS = 0;
export const SIGNAL_MAX_TICK_AGE_MS = 5000;

// The forecast targets the current M1 candle using the latest fully closed candle.
// Permit dispatch throughout that target candle; per-candle dedupe prevents repeats.
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
