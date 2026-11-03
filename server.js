const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { createLiveEngine } = require('./live-engine');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.twelvedata.com/time_series';

// Free-tier protection: at most one Twelve Data refresh every 120 seconds.
// 24/7 continuous scanning is therefore capped at about 720 refreshes/day.
const REFRESH_MS = 120000;
const HISTORY_SIZE = 200;
const KEEP_CANDLES = 220;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

let cache = { at: 0, payload: null };
let inFlight = null;
let candleStore = new Map();
let hasWarmHistory = false;
let liveEngine = null;

function errorPayload(status, message, reason) {
  return {
    symbol: 'EUR/USD', signal: 'STANDBY', regime: status === 'quota_exhausted' ? 'API LIMIT' : 'API ERROR',
    price: '—', rsi: null, apiStatus: status, apiMessage: message, reason,
    candlesLoaded: candleStore.size, refreshIntervalSeconds: REFRESH_MS / 1000
  };
}

async function buildSignal() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return errorPayload('error',
    'กรุณากำหนด TWELVE_DATA_API_KEY ใน Render Environment', 'ยังไม่มี API key');

  try {
    const outputsize = hasWarmHistory ? 2 : HISTORY_SIZE;
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      symbol: 'EUR/USD', interval: '1min', outputsize: String(outputsize),
      timezone: 'UTC', apikey: apiKey
    }).toString();

    const response = await fetch(url.toString(), { timeout: 12000 });
    const data = await response.json();

    if (!response.ok || !data || !Array.isArray(data.values)) {
      const message = (data && data.message) || 'Twelve Data returned invalid data';
      const quota = response.status === 429 || /quota|credits|rate limit|api calls|api requests/i.test(message);
      return errorPayload(quota ? 'quota_exhausted' : 'error', message,
        'ไม่สามารถยืนยันข้อมูลตลาดได้ จึงหยุดการออกสัญญาณ');
    }

    // Only ingest completed M1 bars. Twelve Data timestamps each bar by OPEN time.
    const nowMs = Date.now();
    for (const candle of data.values) {
      const close = Number(candle.close);
      const open = Number(candle.open);
      const high = Number(candle.high);
      const low = Number(candle.low);
      if (!candle.datetime || ![close, open, high, low].every(Number.isFinite)) continue;
      const candleStartMs = new Date(String(candle.datetime).replace(' ', 'T') + 'Z').getTime();
      if (!Number.isFinite(candleStartMs) || candleStartMs + 60000 > nowMs - 2000) continue;
      candleStore.set(String(candle.datetime), {
        datetime: String(candle.datetime), close, open, high, low
      });
    }
    const candles = Array.from(candleStore.values())
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .slice(-KEEP_CANDLES);
    candleStore = new Map(candles.map(c => [c.datetime, c]));
    if (candles.length >= HISTORY_SIZE) hasWarmHistory = true;

    const closes = candles.map(c => c.close);
    if (closes.length < 20) {
      return errorPayload('error', 'ข้อมูลแท่งเทียนไม่ครบ',
        'ต้องมีข้อมูลย้อนหลังอย่างน้อย 20 แท่งเพื่อคำนวณ EMA20');
    }

    const last = candles[candles.length - 1];
    const price = last.close;
    const ema5 = calculateEMA(closes, 5);
    const ema20 = calculateEMA(closes, 20);
    const rsi = calculateRSI(closes, 14);
    const candleTime = new Date(String(last.datetime).replace(' ', 'T') + 'Z');
    const candleClosedAtMs = candleTime.getTime() + 60000;
    const ageMs = Number.isNaN(candleTime.getTime()) ? Infinity : Date.now() - candleClosedAtMs;

    if (ageMs > 180000 || ageMs < -60000) {
      return {
        symbol: 'EUR/USD', signal: 'STANDBY', regime: 'STALE DATA',
        price: price.toFixed(5), datetime: last.datetime, rsi: rsi.toFixed(1),
        ema5: ema5.toFixed(5), ema20: ema20.toFixed(5), apiStatus: 'error',
        apiMessage: 'ข้อมูลราคาเก่าหรือเวลาไม่ถูกต้อง',
        reason: 'ข้อมูลไม่สดใหม่ ระบบจึงบังคับ STANDBY',
        candlesLoaded: candles.length, refreshIntervalSeconds: REFRESH_MS / 1000
      };
    }

    let signal = 'STANDBY';
    let regime = 'CONSOLIDATION';
    if (ema5 > ema20 && rsi >= 50 && rsi <= 75) {
      signal = 'CALL'; regime = 'UPTREND';
    } else if (ema5 < ema20 && rsi >= 25 && rsi <= 50) {
      signal = 'PUT'; regime = 'DOWNTREND';
    }

    return {
      symbol: 'EUR/USD', signal, regime, price: price.toFixed(5),
      datetime: last.datetime, candleClosedAt: new Date(candleClosedAtMs).toISOString(),
      dataAgeSeconds: Math.max(0, Math.floor(ageMs / 1000)),
      rsi: rsi.toFixed(1), ema5: ema5.toFixed(5),
      ema20: ema20.toFixed(5), apiStatus: 'connected',
      apiMessage: 'เชื่อมต่อ Twelve Data แล้ว',
      apiUpdatedAt: new Date().toISOString(),
      reason: 'EMA5 ' + ema5.toFixed(5) + ' / EMA20 ' + ema20.toFixed(5) +
        ' / RSI14 ' + rsi.toFixed(1) + ' / ' + regime,
      candlesLoaded: candles.length,
      historyMode: hasWarmHistory ? 'rolling-update' : 'initial-history',
      refreshIntervalSeconds: REFRESH_MS / 1000
    };
  } catch (err) {
    console.error('Twelve Data error:', err.message);
    return errorPayload('error', 'ข้อผิดพลาดในการเชื่อมต่อ Twelve Data',
      'ระบบหยุดออกสัญญาณจนกว่าจะได้รับข้อมูลที่ยืนยันได้');
  }
}

app.get('/health', (_req, res) => res.json({
  status: 'ok', historyCandles: candleStore.size,
  refreshIntervalSeconds: REFRESH_MS / 1000,
  liveStream: liveEngine ? liveEngine.getStatus() : { status: 'starting' }
}));

app.get('/api/live', (_req, res) => {
  if (!liveEngine) return res.json({ symbol: 'EUR/USD', prediction: 'STANDBY', streamStatus: 'starting', price: '—', reason: 'กำลังเริ่มระบบราคาสด' });
  res.json(liveEngine.prediction());
});

app.get('/api/signal', async (_req, res) => {
  if (cache.payload && Date.now() - cache.at < REFRESH_MS) return res.json(cache.payload);
  if (!inFlight) inFlight = buildSignal().finally(() => { inFlight = null; });
  const payload = await inFlight;
  // Cache quota/rate-limit failures too, so the browser cannot burn credits by retrying every few seconds.
  const cacheFor = payload.apiStatus === 'quota_exhausted' ? REFRESH_MS :
    payload.apiStatus === 'connected' ? REFRESH_MS : 30000;
  cache = { at: Date.now() - (REFRESH_MS - cacheFor), payload };
  res.status(200).json(payload);
});

app.listen(PORT, () => {
  console.log('AI SIGNAL RADAR server listening on', PORT);
  liveEngine = createLiveEngine(process.env.TWELVE_DATA_API_KEY, () =>
    Array.from(candleStore.values()).sort((a, b) => a.datetime.localeCompare(b.datetime))
  );
});