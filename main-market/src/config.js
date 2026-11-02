export const SYMBOLS = Object.freeze([
  "AUD/USD",
  "EUR/USD",
  "EUR/GBP",
  "GBP/JPY",
  "EUR/JPY",
  "GBP/USD"
]);
export const DEFAULT_SYMBOL = "EUR/USD";
export const INTERVAL = "1min";
export const MIN_CLOSED_CANDLES = 200;
export const HISTORY_CANDLES = 220;
export const MAX_CANDLES = 260;
export const REST_SYNC_SECONDS = 300;
export const MAX_CANDLE_AGE_SECONDS = 180;
export const MAX_STREAM_AGE_SECONDS = 25;
export const SIGNAL_HOLD_SECONDS = 40;
export const CLIENT_LEASE_SECONDS = 12;
export const normalizeSymbol = value =>
  String(value ?? "").replace(/\s+/g, "").toUpperCase();
export function resolveSymbol(value) {
  const normalized = normalizeSymbol(value);
  return SYMBOLS.find(symbol => normalizeSymbol(symbol) === normalized) ?? null;
}
// Transitional aliases used by existing service/test imports during the rewrite.
export const MIN_CANDLES = MIN_CLOSED_CANDLES;
export const DEFAULT_SYMBOLS = Object.freeze([DEFAULT_SYMBOL]);
