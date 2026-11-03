'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CONFIG = Object.freeze({
  TIMEFRAME_MS: 60_000,
  REQUIRED_CANDLES: 6,
  MAX_TICK_AGE_MS: 90_000,
  MAX_FUTURE_MS: 5_000,
  MAX_PRICE: 1_000_000,
  MAX_BODY_BYTES: '16kb',
  MAX_RAW_TEXT_CHARS: 12_000,
  MAX_PRICE_STUCK_MS: 20_000,
  MAX_CANDLES: 100
});

app.disable('x-powered-by');
app.use(express.json({ limit: CONFIG.MAX_BODY_BYTES, strict: true }));
app.use(express.static(path.join(__dirname, 'public')));

const markets = new Map();
let totalReceived = 0;
let totalRejected = 0;
let lastRequestAt = null;

function sendStandby(reason, extra = {}) {
  return { accepted: false, status: 'STANDBY', reason, ...extra };
}

function marketKey(symbol, market) {
  return market + ':' + symbol;
}

function newMarket(symbol, market) {
  return {
    symbol, market, current: null, candles: [],
    lastTimestamp: null, lastPrice: null, priceChangedAt: null,
    lastSignal: 'STANDBY', lastError: null
  };
}

// Extract only an unambiguous decimal price. Prefer explicitly labelled lines.
// If a full-screen OCR frame contains several plausible unlabeled prices, reject
// it rather than guessing which chart-axis value is the live quote.
function extractPrice(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > CONFIG.MAX_RAW_TEXT_CHARS) return null;
  const lines = rawText.replace(/\r/g, '\n').split('\n');
  const pattern = /(?<![\d.])(?:\d{1,6})\.\d{4,6}(?!\d)/g;
  const valid = value => Number.isFinite(value) && value > 0 && value < CONFIG.MAX_PRICE;
  const labelled = [];
  const all = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(pattern)].map(m => Number(m[0])).filter(valid);
    all.push(...matches);
    if (/(EUR\s*\/?\s*USD|\b(?:price|bid|ask|last|current)\b|ราคา)/i.test(line)) {
      labelled.push(...matches);
    }
  }

  const candidates = labelled.length ? labelled : all;
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;

  // Some OCR engines split a label and its value into adjacent lines.
  const adjacent = [];
  for (let i = 0; i < lines.length; i++) {
    if (/(EUR\s*\/?\s*USD|\b(?:price|bid|ask|last|current)\b|ราคา)/i.test(lines[i])) {
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= lines.length) continue;
        adjacent.push(...[...lines[j].matchAll(pattern)].map(m => Number(m[0])).filter(valid));
      }
    }
  }
  const adjacentUnique = [...new Set(adjacent)];
  return adjacentUnique.length === 1 ? adjacentUnique[0] : null;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i] * alpha + result * (1 - alpha);
  }
  return result;
}

function calculateRSI(values, period = 5) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(values) {
  if (!Array.isArray(values) || values.length < CONFIG.REQUIRED_CANDLES) return null;
  const fastAlpha = 2 / (3 + 1);
  const slowAlpha = 2 / (5 + 1);
  let fast = values[0];
  let slow = values[0];
  const macdValues = [];
  for (const price of values) {
    fast = price * fastAlpha + fast * (1 - fastAlpha);
    slow = price * slowAlpha + slow * (1 - slowAlpha);
    macdValues.push(fast - slow);
  }
  const macd = macdValues[macdValues.length - 1];
  const signal = ema(macdValues, 2);
  if (signal === null) return null;
  return { macd, signal, histogram: macd - signal };
}

function analyze(candles) {
  if (!Array.isArray(candles) || candles.length < CONFIG.REQUIRED_CANDLES) {
    return { status: 'STANDBY', reason: 'NOT_ENOUGH_CLOSED_CANDLES' };
  }
  const closes = candles.slice(-CONFIG.REQUIRED_CANDLES).map(c => c.close);
  const ema3 = ema(closes, 3);
  const ema5 = ema(closes, 5);
  const rsi5 = calculateRSI(closes, 5);
  const macd = calculateMACD(closes);
  if ([ema3, ema5, rsi5, macd].some(value => value === null)) {
    return { status: 'STANDBY', reason: 'INDICATOR_DATA_INCOMPLETE' };
  }

  let status = 'STANDBY';
  let reason = 'INDICATORS_NOT_ALIGNED';
  if (ema3 > ema5 && rsi5 > 50 && macd.macd > macd.signal && macd.histogram > 0) {
    status = 'CALL';
    reason = 'BULLISH_CONFIRMATION';
  } else if (ema3 < ema5 && rsi5 < 50 && macd.macd < macd.signal && macd.histogram < 0) {
    status = 'PUT';
    reason = 'BEARISH_CONFIRMATION';
  }
  return { status, reason, indicators: { ema3, ema5, rsi5, macd } };
}

function reject(state, reason) {
  totalRejected++;
  if (state) {
    state.lastError = reason;
    state.lastSignal = 'STANDBY';
  }
  return sendStandby(reason);
}

function ingestPrice(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reject(null, 'INVALID_BODY');
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const market = String(input.market || 'OTC').trim().toUpperCase();
  const timestamp = Number(input.timestamp);
  const price = extractPrice(input.rawText);

  if (!symbol || !/^[A-Z0-9/_-]{3,20}$/.test(symbol)) return reject(null, 'INVALID_SYMBOL');
  if (!['OTC', 'NON-OTC'].includes(market)) return reject(null, 'INVALID_MARKET');
  if (price === null) return reject(null, 'AMBIGUOUS_OR_MISSING_PRICE_IN_RAW_TEXT');
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return reject(null, 'INVALID_TIMESTAMP');
  if (timestamp > now + CONFIG.MAX_FUTURE_MS) return reject(null, 'FUTURE_TIMESTAMP');
  if (now - timestamp > CONFIG.MAX_TICK_AGE_MS) return reject(null, 'STALE_OCR_DATA');

  const key = marketKey(symbol, market);
  if (!markets.has(key)) markets.set(key, newMarket(symbol, market));
  const state = markets.get(key);

  if (state.lastTimestamp !== null && timestamp <= state.lastTimestamp) {
    return reject(state, 'DUPLICATE_OR_OLD_TICK');
  }
  if (state.lastPrice !== null && price === state.lastPrice) {
    if (state.priceChangedAt !== null && timestamp - state.priceChangedAt > CONFIG.MAX_PRICE_STUCK_MS) {
      return reject(state, 'PRICE_STUCK');
    }
  } else {
    state.priceChangedAt = timestamp;
  }

  const minute = Math.floor(timestamp / CONFIG.TIMEFRAME_MS) * CONFIG.TIMEFRAME_MS;
  if (!state.current) {
    state.current = { time: minute, open: price, high: price, low: price, close: price, ticks: 1 };
  } else if (minute === state.current.time) {
    state.current.high = Math.max(state.current.high, price);
    state.current.low = Math.min(state.current.low, price);
    state.current.close = price;
    state.current.ticks++;
  } else if (minute === state.current.time + CONFIG.TIMEFRAME_MS) {
    state.candles.push({
      time: state.current.time,
      open: state.current.open,
      high: state.current.high,
      low: state.current.low,
      close: state.current.close,
      ticks: state.current.ticks
    });
    if (state.candles.length > CONFIG.MAX_CANDLES) state.candles.shift();
    state.current = { time: minute, open: price, high: price, low: price, close: price, ticks: 1 };
  } else if (minute > state.current.time + CONFIG.TIMEFRAME_MS) {
    state.candles = [];
    state.current = { time: minute, open: price, high: price, low: price, close: price, ticks: 1 };
    state.lastTimestamp = timestamp;
    state.lastPrice = price;
    state.lastError = 'M1_DATA_GAP_RESET';
    state.lastSignal = 'STANDBY';
    totalReceived++;
    lastRequestAt = now;
    return {
      accepted: true, symbol, market, status: 'STANDBY',
      reason: 'M1_DATA_GAP_RESET', closedCandles: 0, requiredCandles: CONFIG.REQUIRED_CANDLES
    };
  } else {
    return reject(state, 'INVALID_CANDLE_ORDER');
  }

  state.lastTimestamp = timestamp;
  state.lastPrice = price;
  state.lastError = null;
  totalReceived++;
  lastRequestAt = now;

  if (state.candles.length < CONFIG.REQUIRED_CANDLES) {
    state.lastSignal = 'STANDBY';
    return {
      accepted: true, symbol, market, status: 'STANDBY', reason: 'WARMUP',
      closedCandles: state.candles.length, requiredCandles: CONFIG.REQUIRED_CANDLES,
      currentPrice: price
    };
  }

  const result = analyze(state.candles.slice(-CONFIG.REQUIRED_CANDLES));
  state.lastSignal = result.status;
  return {
    accepted: true, symbol, market, status: result.status, reason: result.reason,
    closedCandles: state.candles.length, requiredCandles: CONFIG.REQUIRED_CANDLES,
    currentPrice: price, indicators: result.indicators || null
  };
}

function isFresh(state, now = Date.now()) {
  if (!state || state.lastTimestamp === null) return false;
  const age = now - state.lastTimestamp;
  return age >= 0 && age <= CONFIG.MAX_TICK_AGE_MS &&
    (state.priceChangedAt === null || now - state.priceChangedAt <= CONFIG.MAX_PRICE_STUCK_MS);
}

function signalSnapshot(symbol = 'EUR/USD', market = 'OTC', now = Date.now()) {
  const state = markets.get(marketKey(String(symbol).toUpperCase(), String(market).toUpperCase()));
  if (!state || !isFresh(state, now)) {
    return {
      symbol, market, timeframe: 'M1', source: 'ANDROID_OCR_RAW_TEXT',
      status: 'STANDBY', reason: !state ? 'WAITING_FOR_OCR' :
        (state.priceChangedAt !== null && now - state.priceChangedAt > CONFIG.MAX_PRICE_STUCK_MS ? 'PRICE_STUCK' : 'STALE_OR_MISSING_OCR'),
      closedCandles: state ? state.candles.length : 0,
      requiredCandles: CONFIG.REQUIRED_CANDLES
    };
  }
  const result = analyze(state.candles.slice(-CONFIG.REQUIRED_CANDLES));
  return {
    symbol: state.symbol, market: state.market, timeframe: 'M1',
    source: 'ANDROID_OCR_RAW_TEXT', status: state.candles.length < CONFIG.REQUIRED_CANDLES ? 'STANDBY' : result.status,
    reason: state.candles.length < CONFIG.REQUIRED_CANDLES ? 'WARMUP' : result.reason,
    currentPrice: state.lastPrice, lastTimestamp: new Date(state.lastTimestamp).toISOString(),
    closedCandles: state.candles.length, requiredCandles: CONFIG.REQUIRED_CANDLES,
    indicators: state.candles.length < CONFIG.REQUIRED_CANDLES ? null : (result.indicators || null)
  };
}

function authorized(req) {
  if (!process.env.OCR_API_TOKEN) return true;
  const headerToken = req.get('x-api-token') || '';
  const bearer = req.get('authorization') || '';
  const supplied = headerToken || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');
  const expected = process.env.OCR_API_TOKEN;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ONLINE', mode: 'SERVER_PRICE_EXTRACTION',
    priceSource: 'ANDROID_OCR_RAW_TEXT_ONLY', externalMarketApis: false,
    totalReceived, totalRejected, lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : null,
    marketsTracked: markets.size, tokenConfigured: Boolean(process.env.OCR_API_TOKEN)
  });
});

app.post('/api/ocr/price', (req, res) => {
  if (!authorized(req)) return res.status(401).json(sendStandby('UNAUTHORIZED'));
  const result = ingestPrice(req.body);
  return res.status(result.accepted ? 200 : 400).json(result);
});

app.get('/api/signal', (req, res) => {
  const symbol = req.query.symbol || 'EUR/USD';
  const market = req.query.market || 'OTC';
  res.json(signalSnapshot(symbol, market));
});

app.get('/api/config', (_req, res) => {
  res.json({
    symbol: 'EUR/USD', market: 'OTC', timeframe: 'M1',
    priceSource: 'ANDROID_OCR_RAW_TEXT_ONLY', externalMarketApis: false,
    requiredClosedCandles: CONFIG.REQUIRED_CANDLES,
    indicators: { ema: [3, 5], rsi: 5, macd: [3, 5, 2] },
    staleAfterSeconds: CONFIG.MAX_TICK_AGE_MS / 1000,
    priceStuckAfterSeconds: CONFIG.MAX_PRICE_STUCK_MS / 1000
  });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('AI SIGNAL RADAR OCR CLEAN · SERVER_PRICE_EXTRACTION · port', PORT);
  });
}

module.exports = {
  app, CONFIG, extractPrice, ema, calculateRSI, calculateMACD, analyze,
  ingestPrice, signalSnapshot, isFresh, _resetForTests: () => {
    markets.clear(); totalReceived = 0; totalRejected = 0; lastRequestAt = null;
  }
};
