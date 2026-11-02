import {
  HISTORY_CANDLES,
  MIN_CLOSED_CANDLES,
  SYMBOLS,
  normalizeSymbol
} from "./config.js";

const API_BASE = "https://api.twelvedata.com";
const REQUEST_TIMEOUT_MS = 15000;

function providerError(symbol, body, status) {
  const message = String(body?.message || body?.code || `HTTP ${status}`);
  const error = new Error(`${symbol}: ${message}`);
  error.status = status;
  error.providerCode = body?.code ?? null;
  error.kind = /quota|credit|rate.?limit/i.test(message) || status === 429
    ? "RATE_LIMIT"
    : status === 401 || status === 403
      ? "AUTH_OR_PERMISSION"
      : /symbol|not found|not supported|not available|subscription|plan/i.test(message)
        ? "PAIR_UNAVAILABLE"
        : "PROVIDER_ERROR";
  return error;
}

function parseCandle(value) {
  const epoch = Date.parse(String(value.datetime).replace(" ", "T") + "Z") / 1000;
  const candle = {
    time: String(value.datetime),
    epoch,
    open: Number(value.open),
    high: Number(value.high),
    low: Number(value.low),
    close: Number(value.close),
    live: false
  };
  if (!Number.isFinite(epoch) ||
      ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low) return null;
  return candle;
}

export async function fetchCandles({
  apiKey,
  symbol = "EUR/USD",
  interval = "1min",
  outputsize = HISTORY_CANDLES,
  fetchImpl = fetch,
  now = Date.now()
}) {
  const normalized = normalizeSymbol(symbol);
  const allowed = SYMBOLS.some(item => normalizeSymbol(item) === normalized);
  if (!allowed) throw new Error(`Pair is not enabled: ${symbol}`);
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is not configured");

  const url = new URL("/time_series", API_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("timezone", "UTC");

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `apikey ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const wrapped = new Error(`Twelve Data network error for ${symbol}: ${error.message}`);
    wrapped.kind = "NETWORK_ERROR";
    throw wrapped;
  }

  let body;
  try { body = await response.json(); }
  catch {
    const error = new Error(`Twelve Data returned invalid JSON for ${symbol}`);
    error.kind = "INVALID_RESPONSE";
    throw error;
  }

  if (!response.ok || body?.status === "error" || !Array.isArray(body?.values)) {
    throw providerError(symbol, body, response.status);
  }

  const minuteStart = Math.floor(now / 60000) * 60;
  const byEpoch = new Map();
  for (const raw of body.values) {
    const candle = parseCandle(raw);
    if (!candle || candle.epoch >= minuteStart) continue;
    byEpoch.set(candle.epoch, candle);
  }

  const candles = [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch);
  if (candles.length < MIN_CLOSED_CANDLES) {
    const error = new Error(
      `${symbol}: insufficient closed M1 candles ${candles.length}/${MIN_CLOSED_CANDLES}`
    );
    error.kind = "INSUFFICIENT_HISTORY";
    throw error;
  }

  return {
    symbol: body.meta?.symbol || symbol,
    interval: body.meta?.interval || interval,
    candles: candles.slice(-HISTORY_CANDLES),
    receivedAt: now,
    source: "Twelve Data REST"
  };
}
