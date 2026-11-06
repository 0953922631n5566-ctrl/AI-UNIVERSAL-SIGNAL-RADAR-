export const SIGNAL_PRE_CLOSE_MIN_MS = 3000;
export const SIGNAL_PRE_CLOSE_MAX_MS = 5000;
export const SIGNAL_DISPATCH_COOLDOWN_MS = 60000;
export const SIGNAL_MAX_TICK_AGE_MS = 5000;

export function isSignalPreCloseWindow(candleEpoch, now = Date.now()) {
  if (!Number.isFinite(candleEpoch) || !Number.isFinite(now)) return false;
  const remaining = (candleEpoch + 60) * 1000 - now;
  return remaining >= SIGNAL_PRE_CLOSE_MIN_MS && remaining <= SIGNAL_PRE_CLOSE_MAX_MS;
}

export function isFreshSignalTick(tickAt, now = Date.now()) {
  return Number.isFinite(tickAt) && Number.isFinite(now) &&
    tickAt <= now && now - tickAt <= SIGNAL_MAX_TICK_AGE_MS;
}

export function canDispatchSignal({ candleEpoch, tickAt, now = Date.now(),
  lastDispatchedAt = 0, lastDispatchedCandle = null } = {}) {
  const cooldownElapsed = !lastDispatchedAt ||
    now - lastDispatchedAt >= SIGNAL_DISPATCH_COOLDOWN_MS;
  return isSignalPreCloseWindow(candleEpoch, now) &&
    isFreshSignalTick(tickAt, now) &&
    lastDispatchedCandle !== candleEpoch &&
    cooldownElapsed;
}
