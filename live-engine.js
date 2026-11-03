const WebSocket = require('ws');

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(values, period) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function createLiveEngine(apiKey, getClosedCandles) {
  let socket = null;
  let status = apiKey ? 'connecting' : 'unavailable';
  let message = apiKey ? 'กำลังเชื่อมต่อ Twelve Data WebSocket' : 'ยังไม่มี API key';
  let ticks = [];
  let retryTimer = null;
  let heartbeatTimer = null;
  let retryDelay = 5000;
  let stopped = false;

  function connect() {
    if (stopped || !apiKey || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
    clearTimeout(retryTimer);
    status = 'connecting';
    const ws = new WebSocket('wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(apiKey));
    socket = ws;

    ws.on('open', () => {
      status = 'authorizing';
      message = 'เชื่อมต่อแล้ว กำลังขอสิทธิ์สตรีม EUR/USD';
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: 'EUR/USD' } }));
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'heartbeat' }));
      }, 10000);
    });

    ws.on('message', raw => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch (_) { return; }
      if (event.event === 'subscribe-status') {
        const ok = event.status === 'ok' && Array.isArray(event.success) &&
          event.success.some(x => String(x.symbol || '').replace(/\s/g, '').toUpperCase() === 'EUR/USD');
        if (ok) {
          status = 'subscribed';
          message = 'ได้รับสิทธิ์สตรีม EUR/USD แล้ว';
          retryDelay = 5000;
        } else {
          const fail = Array.isArray(event.fails) ? event.fails[0] : null;
          status = 'unavailable';
          message = (fail && (fail.message || fail.code)) || event.message ||
            'แพ็กเกจหรือสิทธิ์ API ยังไม่อนุญาตสตรีม EUR/USD';
        }
        return;
      }
      if (event.event === 'price' && String(event.symbol || '').replace(/\s/g, '').toUpperCase() === 'EUR/USD') {
        const price = Number(event.price);
        const timestamp = Number(event.timestamp) * 1000;
        const now = Date.now();
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) ||
            timestamp > now + 10000 || now - timestamp > 30000) return;
        ticks.push({ price, timestamp });
        if (ticks.length > 120) ticks = ticks.slice(-120);
        status = 'subscribed';
        message = 'รับราคาสด EUR/USD';
      }
      if (event.event === 'error' || event.status === 'error') {
        status = 'unavailable';
        message = event.message || 'Twelve Data ปฏิเสธการเชื่อมต่อราคาสด';
      }
    });

    ws.on('error', () => {
      status = 'error';
      message = 'เชื่อมต่อ WebSocket ไม่สำเร็จ';
    });
    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      if (socket === ws) socket = null;
      if (!stopped && status !== 'unavailable') {
        status = 'reconnecting';
        message = 'WebSocket หลุด กำลังเชื่อมต่อใหม่';
        const wait = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 60000);
        retryTimer = setTimeout(connect, wait);
      }
    });
  }

  function prediction() {
    const now = Date.now();
    const tick = ticks[ticks.length - 1];
    const age = tick ? now - tick.timestamp : Infinity;
    const base = {
      symbol: 'EUR/USD', prediction: 'STANDBY', streamStatus: status,
      price: tick ? tick.price.toFixed(5) : '—',
      dataAgeSeconds: Number.isFinite(age) ? Math.max(0, Math.floor(age / 1000)) : null,
      timestamp: tick ? new Date(tick.timestamp).toISOString() : null,
      ema5: null, ema20: null, rsi: null, momentum: null
    };
    if (status !== 'subscribed' || !tick || age > 15000 || age < -10000) {
      base.reason = message + ' · ไม่มี Tick สดจึงงดออกสัญญาณ';
      return base;
    }

    const closed = getClosedCandles().slice(-220);
    if (closed.length < 20) {
      base.reason = 'รอประวัติแท่งปิดอย่างน้อย 20 แท่งเพื่อใช้เป็นฐาน';
      return base;
    }
    const prices = closed.map(c => c.close).concat(tick.price);
    const ema5 = calculateEMA(prices, 5);
    const ema20 = calculateEMA(prices, 20);
    const rsi = calculateRSI(prices, 14);
    const oldTick = ticks.find(t => t.timestamp <= now - 5000) || ticks[0];
    const momentum = oldTick && tick.timestamp - oldTick.timestamp >= 2000
      ? tick.price - oldTick.price : null;
    base.ema5 = ema5.toFixed(5);
    base.ema20 = ema20.toFixed(5);
    base.rsi = rsi.toFixed(1);
    base.momentum = momentum === null ? null : Number(momentum.toFixed(6));

    if (momentum !== null && ema5 > ema20 && rsi >= 50 && rsi <= 78 && momentum > 0.000005) {
      base.prediction = 'CALL';
      base.reason = 'ราคาสดเหนือ EMA5/EMA20 และ Momentum เป็นบวก · ประเมินแท่งถัดไป';
    } else if (momentum !== null && ema5 < ema20 && rsi >= 22 && rsi <= 50 && momentum < -0.000005) {
      base.prediction = 'PUT';
      base.reason = 'ราคาสดใต้ EMA5/EMA20 และ Momentum เป็นลบ · ประเมินแท่งถัดไป';
    } else {
      base.reason = momentum === null
        ? 'รอ Tick ต่อเนื่องอย่างน้อย 2 วินาทีเพื่อวัด Momentum'
        : 'แรงราคาและแนวโน้มยังไม่สอดคล้องกัน · STANDBY';
    }
    return base;
  }

  connect();
  return {
    prediction,
    getStatus: () => ({ status, message }),
    stop: () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(heartbeatTimer);
      if (socket) socket.close();
    }
  };
}

module.exports = { createLiveEngine };
