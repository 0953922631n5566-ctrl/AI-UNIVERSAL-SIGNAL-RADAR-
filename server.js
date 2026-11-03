const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { createLiveEngine } = require('./live-engine');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.twelvedata.com/time_series';

// Free-tier protection: at most one Twelve Data refresh every 120 seconds.
// 24/7 continuous scanning is therefore capped at about 720 refreshes/day.
const REFRESH_MS = 60000; // one history refresh per M1 candle (up to 1,440 calls/day)
const HISTORY_SIZE = 200;
const KEEP_CANDLES = 220;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
      symbol: 'EUR/USD', interval: '1min', outputsize: String(hasWarmHistory ? 3 : HISTORY_SIZE),
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

    if (candles.length < 35) {
      return errorPayload('error', 'ข้อมูลแท่งเทียนไม่ครบ',
        'ต้องมีข้อมูลย้อนหลังอย่างน้อย 35 แท่งสำหรับพยากรณ์ M1 ถัดไป');
    }

    const last = candles[candles.length - 1];
    const price = last.close;
    const candleTime = new Date(String(last.datetime).replace(' ', 'T') + 'Z');
    const candleClosedAtMs = candleTime.getTime() + 60000;
    const ageMs = Number.isNaN(candleTime.getTime()) ? Infinity : Date.now() - candleClosedAtMs;

    if (ageMs > 180000 || ageMs < -60000) {
      return {
        symbol: 'EUR/USD', signal: 'STANDBY', regime: 'STALE DATA',
        price: price.toFixed(5), datetime: last.datetime,
        candleClosedAt: new Date(candleClosedAtMs).toISOString(),
        apiStatus: 'error', apiMessage: 'ข้อมูลราคาเก่าหรือเวลาไม่ถูกต้อง',
        reason: 'ข้อมูล REST ไม่สด ระบบจึงงดการยืนยันผลพยากรณ์',
        candlesLoaded: candles.length, refreshIntervalSeconds: REFRESH_MS / 1000
      };
    }

    return {
      symbol: 'EUR/USD', signal: 'DATA_ONLY', regime: 'MARKET DATA',
      price: price.toFixed(5), datetime: last.datetime,
      candleClosedAt: new Date(candleClosedAtMs).toISOString(),
      dataAgeSeconds: Math.max(0, Math.floor(ageMs / 1000)),
      rsi: null, ema5: null, ema20: null, apiStatus: 'connected',
      apiMessage: 'เชื่อมต่อ Twelve Data แล้ว · REST ใช้เป็นข้อมูลแท่งย้อนหลังเท่านั้น',
      apiUpdatedAt: new Date().toISOString(),
      reason: 'REST HISTORY READY · DIRECTION IS DECIDED BY NEXT M1 FORECAST ONLY',
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
  refreshIntervalSeconds: REFRESH_MS / 1000, pollingMode: 'M1_CANDLE_CLOSE',
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

  // Align one REST refresh just after every UTC M1 boundary.
  // Each refresh ingests completed bars and recomputes only when a new candle closes.
  function scheduleMinuteRefresh() {
    const delay = 60000 - (Date.now() % 60000) + 2000;
    setTimeout(async () => {
      try {
        const payload = await buildSignal();
        cache = { at: Date.now(), payload };
        console.log('M1 close refresh:', payload.apiStatus, 'candles:', payload.candlesLoaded || candleStore.size);
      } catch (err) { console.error('M1 refresh failed:', err.message); }
      scheduleMinuteRefresh();
    }, delay);
  }
  scheduleMinuteRefresh();

  if (process.env.TWELVE_DATA_API_KEY) {
    if (!inFlight) {
      inFlight = buildSignal()
        .then(payload => {
          cache = { at: Date.now(), payload };
          console.log('Startup history warm-up:', payload.apiStatus,
            'candles:', payload.candlesLoaded || candleStore.size);
          return payload;
        })
        .catch(err => {
          console.error('Startup history warm-up failed:', err.message);
        })
        .finally(() => { inFlight = null; });
    }
  }
});