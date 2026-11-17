/**
 * Build a safe provisional snapshot of the currently forming M1 candle.
 * The snapshot is for intrabar analysis only; it never changes the stored candle
 * or represents a provider-confirmed closed candle.
 */
export function createLiveCandlePreview(candle, {
  now = Date.now(), tickAt, maxAgeMs = 25_000
} = {}) {
  if (!candle || candle.live !== true || !Number.isFinite(candle.epoch) ||
      !Number.isFinite(now) || candle.epoch !== Math.floor(now / 60_000) * 60) return null;
  if (!Number.isFinite(tickAt) || tickAt > now || now - tickAt > maxAgeMs) return null;
  const values = [candle.open, candle.high, candle.low, candle.close];
  if (!values.every(Number.isFinite) || candle.low <= 0 ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low) return null;
  return { ...candle, live: false, provisional: true };
}
