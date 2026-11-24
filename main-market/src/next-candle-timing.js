export const M1_MS = 60_000;
export const SIGNAL_HOLD_MS = 30_000;
export const MAX_TICK_AGE_MS = 5_000;

export function createNextCandleSignal({ signal, sourceCandleEpoch, now, entryPrice, alertId }) {
  if (!["CALL", "PUT"].includes(signal) || !Number.isFinite(sourceCandleEpoch) || !Number.isFinite(now)) return null;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const targetOpensAt = targetCandleEpoch * 1000;
  if (now >= targetOpensAt || now < sourceCandleEpoch * 1000) return null;
  return {
    signal, sourceCandleEpoch, targetCandleEpoch,
    triggeredAt: now, targetOpensAt,
    expiresAt: targetOpensAt + SIGNAL_HOLD_MS,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    alertId: alertId || "M1:" + targetCandleEpoch + ":" + signal
  };
}

export function canDispatchNextCandleSignal(active, { now, tickAt, lastDispatchedTargetCandle }) {
  if (!active || !["CALL", "PUT"].includes(active.signal)) return false;
  if (!Number.isFinite(now) || !Number.isFinite(tickAt)) return false;
  if (now >= active.targetOpensAt || now >= active.expiresAt ||
      now - tickAt < 0 || now - tickAt > MAX_TICK_AGE_MS) return false;
  if (active.targetCandleEpoch !== active.sourceCandleEpoch + 60 ||
      active.targetOpensAt !== active.targetCandleEpoch * 1000 ||
      active.expiresAt !== active.targetOpensAt + SIGNAL_HOLD_MS) return false;
  if (lastDispatchedTargetCandle === active.targetCandleEpoch) return false;
  return true;
}
