export const SYMBOLS = Object.freeze(["EUR/USD"]);
export const DEFAULT_SYMBOL = "EUR/USD";
export const INTERVAL = "1min";
// Original AI regime scanner needs 200 completed M1 candles for EMA200/ADX context.
export const MIN_CLOSED_CANDLES = 200;
export const HISTORY_CANDLES = 200;
// Keep room for the in-progress live candle without evicting required closed history.
export const MAX_CANDLES = 220;
export const REST_SYNC_SECONDS = 180;
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
export const MIN_CANDLES = MIN_CLOSED_CANDLES;
export const DEFAULT_SYMBOLS = Object.freeze([DEFAULT_SYMBOL]);

export const DIRECTIONAL_THRESHOLD = 53;
export const ANALOGUE_PATTERN_CANDLES = 8;
export const ANALOGUE_TOP_K = 20;
export const ANALOGUE_MIN_MATCHES = 12;
