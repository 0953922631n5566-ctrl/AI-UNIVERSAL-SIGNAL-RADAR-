const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY || 'YOUR_TWELVE_DATA_API_KEY';
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let marketState = { lastTimestamp: null, lastSignal: 'STANDBY', cooldownActive: false, history: [] };
let apiState = { status: 'connecting', message: 'กำลังเชื่อมต่อ Twelve Data' };

async function fetchMarketData() {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=1min&outputsize=30&apikey=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'error' || !data.values) {
      const message = data.message || 'Failed to fetch Twelve Data';
      const quota = /quota|credits|api calls|api requests|rate limit|per day|per minute/i.test(message) || Number(data.code) === 429 || response.status === 429;
      apiState = { status: quota ? 'quota_exhausted' : 'error', message };
      throw new Error(message);
    }
    apiState = { status: 'connected', message: 'เชื่อมต่อ API แล้ว' };
    return data.values.reverse();
  } catch (error) {
    if (apiState.status === 'connecting' || apiState.status === 'connected') apiState = { status: 'error', message: error.message || 'เชื่อมต่อ API ไม่สำเร็จ' };
    console.error('Data Engine Error:', error.message);
    return null;
  }
}
function calculateEMA(prices, period) {
  const k = 2 / (period + 1); let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
  return ema;
}
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const change = closes[i] - closes[i - 1]; if (change > 0) gains += change; else losses -= change; }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss; return 100 - (100 / (1 + rs));
}
function classifyRegime(candles) {
  const closes = candles.map(c => parseFloat(c.close));
  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));
  const currentVolatility = Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5));
  const avgVolatility = highs.reduce((sum, h, i) => sum + (h - lows[i]), 0) / highs.length;
  if (currentVolatility > avgVolatility * 1.8) return 'HIGH_VOLATILITY';
  const emaFast = calculateEMA(closes.slice(-10), 5), emaSlow = calculateEMA(closes.slice(-20), 10);
  if (Math.abs(emaFast - emaSlow) > 0.0005) return 'TRENDING';
  const last = candles[candles.length - 1];
  const body = Math.abs(parseFloat(last.close) - parseFloat(last.open)), range = parseFloat(last.high) - parseFloat(last.low);
  if (range > 0 && (body / range) < 0.3 && currentVolatility < avgVolatility) return 'REVERSAL';
  return 'RANGING';
}
function evaluateSignal(candles) {
  const closes = candles.map(c => parseFloat(c.close)), regime = classifyRegime(candles);
  const rsi = calculateRSI(closes), emaShort = calculateEMA(closes, 5), emaLong = calculateEMA(closes, 20);
  let signal = 'STANDBY', reason = `Regime: ${regime} | Market neutral, waiting for clear confirmation.`;
  if (marketState.cooldownActive) { marketState.cooldownActive = false; return { signal: 'STANDBY', regime, reason: 'Cooldown Rule Active: Skipping this candle to alternate execution.' }; }
  if (regime === 'HIGH_VOLATILITY' || regime === 'RANGING') return { signal: 'STANDBY', regime, reason: `High risk or sideways market (${regime}). Standby enforced.` };
  if (emaShort > emaLong && rsi < 65 && regime === 'TRENDING') {
    signal = 'CALL'; reason = `Trending Up: EMA short above long, RSI (${rsi.toFixed(1)}) healthy.`; marketState.cooldownActive = true;
  } else if (emaShort < emaLong && rsi > 35 && regime === 'TRENDING') {
    signal = 'PUT'; reason = `Trending Down: EMA short below long, RSI (${rsi.toFixed(1)}) healthy.`; marketState.cooldownActive = true;
  } else if (regime === 'REVERSAL') {
    const lastC = candles[candles.length - 1];
    if (parseFloat(lastC.close) > parseFloat(lastC.open) && rsi < 40) { signal = 'CALL'; reason = `Reversal Bullish detected at oversold RSI (${rsi.toFixed(1)}).`; marketState.cooldownActive = true; }
    else if (parseFloat(lastC.close) < parseFloat(lastC.open) && rsi > 60) { signal = 'PUT'; reason = `Reversal Bearish detected at overbought RSI (${rsi.toFixed(1)}).`; marketState.cooldownActive = true; }
  }
  return { signal, regime, reason };
}
app.get('/api/signal', async (req, res) => {
  const candles = await fetchMarketData();
  if (!candles || candles.length === 0) return res.status(200).json({ symbol: 'EUR/USD', signal: 'STANDBY', regime: 'API_UNAVAILABLE', reason: apiState.message, apiStatus: apiState.status, apiMessage: apiState.message });
  const currentCandle = candles[candles.length - 1];
  const isDataStale = (Date.now() - new Date(currentCandle.datetime).getTime()) > 180000;
  if (isDataStale) return res.json({ symbol: 'EUR/USD', price: currentCandle.close, datetime: currentCandle.datetime, signal: 'STANDBY', regime: 'UNCLEAR', reason: 'Data is stale or delayed. Safety standby activated.', apiStatus: apiState.status, apiMessage: apiState.message });
  if (marketState.lastTimestamp !== currentCandle.datetime) {
    marketState.lastTimestamp = currentCandle.datetime;
    const evaluation = evaluateSignal(candles);
    marketState.lastSignal = evaluation.signal; marketState.lastRegime = evaluation.regime; marketState.lastReason = evaluation.reason;
  }
  res.json({ symbol: 'EUR/USD', price: currentCandle.close, datetime: currentCandle.datetime, signal: marketState.lastSignal, regime: marketState.lastRegime || 'ANALYZING', reason: marketState.lastReason || 'Processing market parameters...', cooldown: marketState.cooldownActive, apiStatus: apiState.status, apiMessage: apiState.message });
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
