export const STREAM_FIRST_TICK_TIMEOUT_MS = 25_000;

export function getStreamRetryReason({
  monitoring, selectedSymbol, feedSymbol, tickAt, streamStatus,
  subscribeAt, now = Date.now(), maxStreamAgeMs = 25_000,
  firstTickTimeoutMs = STREAM_FIRST_TICK_TIMEOUT_MS
}) {
  if (!monitoring || !feedSymbol || selectedSymbol !== feedSymbol) return null;
  if (tickAt && now - tickAt > maxStreamAgeMs) return "STALE_TICK";
  if (!tickAt && ["SUBSCRIBING", "SUBSCRIBED"].includes(streamStatus) &&
      subscribeAt && now - subscribeAt > firstTickTimeoutMs) return "FIRST_TICK_TIMEOUT";
  return null;
}
