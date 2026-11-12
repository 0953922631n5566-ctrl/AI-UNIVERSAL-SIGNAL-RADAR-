export const SYMBOLS = Object.freeze(["AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"]);
export const DEFAULT_SYMBOL = "EUR/USD";
export const INTERVAL = "1min";
// Analysis window: 50 closed M1 context candles + 4 latest closed entry candles.
export const CONTEXT_CANDLES = 50;
export const ENTRY_CANDLES = 4;
export const MIN_CLOSED_CANDLES = CONTEXT_CANDLES + ENTRY_CANDLES;
export const HISTORY_CANDLES = 320;
// Keep room for the in-progress live candle while warming up the longest adaptive EMA horizon.
export const MAX_CANDLES = HISTORY_CANDLES + 10;
export const REST_SYNC_SECONDS = 180;
// Check the live WebSocket feed locally; this does not create a REST/API request.
export const LIVE_PRICE_CHECK_SECONDS = 5;
export const MAX_CANDLE_AGE_SECONDS = 180;
export const MAX_STREAM_AGE_SECONDS = 25;
// Keep the entry signal visible for exactly 30 seconds after the target M1 candle opens.
export const SIGNAL_HOLD_SECONDS = 30;
export const CLIENT_LEASE_SECONDS = 12;
export const normalizeSymbol = value =>
  String(value ?? "").replace(/\s+/g, "").toUpperCase();
export function resolveSymbol(value) {
  const normalized = normalizeSymbol(value);
  return SYMBOLS.find(symbol => normalizeSymbol(symbol) === normalized) ?? null;
}
export const MIN_CANDLES = MIN_CLOSED_CANDLES;
export const DEFAULT_SYMBOLS = Object.freeze([...SYMBOLS]);

export const DIRECTIONAL_THRESHOLD = 53;
export const ANALOGUE_PATTERN_CANDLES = 8;
export const ANALOGUE_TOP_K = 20;
export const ANALOGUE_MIN_MATCHES = 12;
