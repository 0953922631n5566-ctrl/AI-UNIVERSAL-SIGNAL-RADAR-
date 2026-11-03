const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.twelvedata.com/time_series';

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

async function buildSignal() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return { symbol:'EUR/USD', signal:'STANDBY', regime:'NO API KEY', price:'—', rsi:null,
      apiStatus:'error', apiMessage:'กรุณากำหนด TWELVE_DATA_API_KEY ใน Render Environment',
      reason:'ยังไม่มี API key' };
  }

  try {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      symbol:'EUR/USD', interval:'1min', outputsize:'30', timezone:'UTC', apikey:apiKey
    }).toString();

    const response = await fetch(url.toString(), { timeout:12000 });
    const data = await response.json();

    if (!response.ok || !data || !Array.isArray(data.values)) {
      const message = (data && data.message) || 'Twelve Data returned invalid data';
      const quota = response.status === 429 || /quota|credits|rate limit|api calls|api requests/i.test(message);
      return { symbol:'EUR/USD', signal:'STANDBY', regime:quota?'API LIMIT':'API ERROR',
        price:'—', rsi:null, apiStatus:quota?'quota_exhausted':'error',
        apiMessage:message, reason:'ไม่สามารถยืนยันข้อมูลตลาดได้ จึงหยุดการออกสัญญาณ' };
    }

    const candles = data.values.slice().reverse();
    const closes = candles.map(c => Number(c.close));
    if (closes.length < 20 || closes.some(v => !Number.isFinite(v))) {
      return { symbol:'EUR/USD', signal:'STANDBY', regime:'INVALID DATA', price:'—',
        rsi:null, apiStatus:'error', apiMessage:'ข้อมูลแท่งเทียนไม่ครบ',
        reason:'ต้องมีข้อมูลแท่งเทียนอย่างน้อย 20 แท่ง' };
    }

    const last = candles[candles.length - 1];
    const price = closes[closes.length - 1];
    const ema5 = calculateEMA(closes, 5);
    const ema20 = calculateEMA(closes, 20);
    const rsi = calculateRSI(closes, 14);
    const candleTime = new Date(String(last.datetime).replace(' ', 'T') + 'Z');
    const ageMs = Number.isNaN(candleTime.getTime()) ? Infinity : Date.now() - candleTime.getTime();

    if (ageMs > 180000 || ageMs < -60000) {
      return { symbol:'EUR/USD', signal:'STANDBY', regime:'STALE DATA',
        price:price.toFixed(5), datetime:last.datetime, rsi:rsi.toFixed(1),
        ema5:ema5.toFixed(5), ema20:ema20.toFixed(5), apiStatus:'error',
        apiMessage:'ข้อมูลราคาเก่าหรือเวลาไม่ถูกต้อง',
        reason:'ข้อมูลไม่สดใหม่ ระบบจึงบังคับ STANDBY' };
    }

    let signal = 'STANDBY';
    let regime = 'CONSOLIDATION';
    if (ema5 > ema20 && rsi >= 50 && rsi <= 75) {
      signal = 'CALL';
      regime = 'STRONG UPTREND';
    } else if (ema5 < ema20 && rsi >= 25 && rsi <= 50) {
      signal = 'PUT';
      regime = 'STRONG DOWNTREND';
    }

    return { symbol:'EUR/USD', signal, regime, price:price.toFixed(5),
      datetime:last.datetime, rsi:rsi.toFixed(1), ema5:ema5.toFixed(5),
      ema20:ema20.toFixed(5), apiStatus:'connected', apiMessage:'เชื่อมต่อ API แล้ว',
      reason:`EMA5: ${ema5.toFixed(5)} · EMA20: ${ema20.toFixed(5)} · RSI14: ${rsi.toFixed(1)} · ${regime}` };
  } catch (err) {
    console.error('Twelve Data error:', err.message);
    return { symbol:'EUR/USD', signal:'STANDBY', regime:'API ERROR', price:'—',
      rsi:null, apiStatus:'error', apiMessage:'ข้อผิดพลาดในการเชื่อมต่อ Twelve Data',
      reason:'ระบบหยุดออกสัญญาณจนกว่าจะได้รับข้อมูลที่ยืนยันได้' };
  }
}

app.get('/health', (_req, res) => res.json({ status:'ok' }));
app.get('/api/signal', async (_req, res) => {
  if (cache.payload && Date.now() - cache.at < 12000) return res.json(cache.payload);
  if (!inFlight) inFlight = buildSignal().finally(() => { inFlight = null; });
  const payload = await inFlight;
  if (payload.apiStatus === 'connected') cache = { at:Date.now(), payload };
  res.status(200).json(payload);
});

app.listen(PORT, () => console.log('AI SIGNAL RADAR server listening on', PORT));
