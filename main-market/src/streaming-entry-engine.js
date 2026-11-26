// Streaming-first M1 entry engine v1. Uses Twelve Data native EMA5/EMA20/ATR14 with live OHLC ticks.
export const NEXT_SIGNAL_THRESHOLD = 58;
export const NEXT_PREPARE_THRESHOLD = 46;
export const NEXT_SIGNAL_HOLD_MS = 30_000;
export const NEXT_SIGNAL_MAX_TICK_AGE_MS = 5_000;
