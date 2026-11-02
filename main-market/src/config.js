export const MIN_CANDLES=200;
export const HISTORY_CANDLES=220;
export const MAX_CANDLES=260;
// Single selected pair; restore the original five-minute REST refresh cadence.
export const REST_SYNC_SECONDS=300;
export const SYMBOLS=Object.freeze(["AUD/USD","EUR/USD","EUR/GBP","GBP/JPY","EUR/JPY","GBP/USD"]);
export const DEFAULT_SYMBOLS=Object.freeze(["EUR/USD"]);
export const normalizeSymbol=s=>String(s||"").replace(/\s+/g,"").toUpperCase();
