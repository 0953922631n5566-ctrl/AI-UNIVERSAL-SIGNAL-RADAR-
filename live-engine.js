const WebSocket = require('ws');
const { evaluateNextCandle } = require('./forecast-engine');

function createLiveEngine(apiKey, getClosedCandles) {
  let socket = null, status = apiKey ? 'connecting' : 'unavailable';
  let message = apiKey ? 'กำลังเชื่อมต่อ Twelve Data WebSocket' : 'ยังไม่มี API key';
  let tick = null, retryTimer = null, heartbeatTimer = null, retryDelay = 5000, stopped = false;
  let evaluatedCandleKey = null, cachedForecast = null;

  function connect() {
    if (stopped || !apiKey || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
    clearTimeout(retryTimer);
    status = 'connecting';
    const ws = new WebSocket('wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(apiKey));
    socket = ws;
    ws.on('open', () => {
      status = 'authorizing'; message = 'เชื่อมต่อแล้ว กำลังขอราคาสด EUR/USD';
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: 'EUR/USD' } }));
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'heartbeat' })); }, 10000);
    });
    ws.on('message', raw => {
      let event; try { event = JSON.parse(raw.toString()); } catch (_) { return; }
      if (event.event === 'subscribe-status') {
        const ok = event.status === 'ok' && Array.isArray(event.success) &&
          event.success.some(x => String(x.symbol || '').replace(/\s/g,'').toUpperCase() === 'EUR/USD');
        status = ok ? 'subscribed' : 'unavailable';
        message = ok ? 'ได้รับสิทธิ์ราคาสด EUR/USD แล้ว' : ((event.fails && event.fails[0] && event.fails[0].message) || event.message || 'แพ็กเกจไม่อนุญาต WebSocket');
        if (ok) retryDelay = 5000;
      }
      if (event.event === 'price' && String(event.symbol || '').replace(/\s/g,'').toUpperCase() === 'EUR/USD') {
        const price = Number(event.price), timestamp = Number(event.timestamp) * 1000, now = Date.now();
        if (Number.isFinite(price) && price > 0 && Number.isFinite(timestamp) && timestamp <= now + 10000 && now - timestamp <= 30000) {
          tick = { price, timestamp }; status = 'subscribed'; message = 'รับราคาสด EUR/USD';
        }
      }
      if (event.event === 'error' || event.status === 'error') { status = 'unavailable'; message = event.message || 'Twelve Data ปฏิเสธการเชื่อมต่อ'; }
    });
    ws.on('error', () => { status = 'error'; message = 'เชื่อมต่อ WebSocket ไม่สำเร็จ'; });
    ws.on('close', () => {
      clearInterval(heartbeatTimer); if (socket === ws) socket = null;
      if (!stopped && status !== 'unavailable') {
        status = 'reconnecting'; message = 'WebSocket หลุด กำลังเชื่อมต่อใหม่';
        const wait = retryDelay; retryDelay = Math.min(retryDelay * 2, 60000); retryTimer = setTimeout(connect, wait);
      }
    });
  }

  function prediction() {
    const candles = getClosedCandles().slice(-220);
    const last = candles.at(-1);
    const key = last && last.datetime;
    if (key && key !== evaluatedCandleKey) {
      evaluatedCandleKey = key;
      cachedForecast = evaluateNextCandle(candles);
    }
    const closedAt = last ? Date.parse(String(last.datetime).replace(' ','T') + 'Z') + 60000 : NaN;
    const age = Number.isFinite(closedAt) ? Date.now() - closedAt : Infinity;
    let forecast = cachedForecast || { signal:'STANDBY', agreementVotes:'0/6', agreementScore:0, horizon:1, reason:'รอแท่ง M1 ปิดครบ 35 แท่ง' };
    if (!last || age < -10000 || age > 90000) forecast = {
      signal:'STANDBY', agreementVotes:'0/6', agreementScore:0, horizon:1,
      reason:'แท่ง M1 ล่าสุดเก่าหรือยังไม่ยืนยัน · งดสัญญาณ'
    };
    const tickAge = tick ? Date.now() - tick.timestamp : Infinity;
    return {
      symbol:'EUR/USD', prediction:forecast.signal, forecast, streamStatus:status,
      price:tick && tickAge <= 75000 ? tick.price.toFixed(5) : '—',
      dataAgeSeconds:Number.isFinite(tickAge) ? Math.max(0,Math.floor(tickAge/1000)) : null,
      timestamp:tick ? new Date(tick.timestamp).toISOString() : null,
      lastClosedCandle:key || null, closedCandleAgeSeconds:Number.isFinite(age) ? Math.max(0,Math.floor(age/1000)) : null,
      reason:forecast.reason, ema5:forecast.indicators && forecast.indicators.ema5,
      ema20:forecast.indicators && forecast.indicators.ema20,
      rsi:forecast.indicators && forecast.indicators.rsi14
    };
  }
  connect();
  return { prediction, getStatus:()=>({status,message}), stop:()=>{stopped=true;clearTimeout(retryTimer);clearInterval(heartbeatTimer);if(socket)socket.close();} };
}
module.exports = { createLiveEngine };
