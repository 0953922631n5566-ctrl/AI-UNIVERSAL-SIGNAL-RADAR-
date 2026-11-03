const WebSocket = require('ws');
const { evaluateNextCandle } = require('./forecast-engine');

// Builds completed M1 candles from the live quote stream. It never fabricates missing minutes.
// When only one quote arrives in a minute, the first quote of the next minute is used as that
// minute's close (continuous FX prices share the prior close and next open).
function createMinuteCandleAggregator() {
  let current = null;
  const completed = new Map();

  function startBar(minuteStart, price, timestamp) {
    current = {
      minuteStart, open: price, high: price, low: price, close: price,
      ticks: 1, lastTimestamp: timestamp
    };
  }

  function ingest(price, timestamp) {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return null;
    const minuteStart = Math.floor(timestamp / 60000) * 60000;
    if (!current) {
      startBar(minuteStart, price, timestamp);
      return null;
    }
    if (minuteStart < current.minuteStart || timestamp < current.lastTimestamp) return null;
    if (minuteStart === current.minuteStart) {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.ticks += 1;
      current.lastTimestamp = timestamp;
      return null;
    }

    let finalized = null;
    if (minuteStart === current.minuteStart + 60000) {
      // Prefer the final in-minute tick. If there was only one boundary tick, use the
      // next boundary quote as the previous candle's close so a usable M1 body is formed.
      const close = current.ticks > 1 ? current.close : price;
      finalized = {
        datetime: new Date(current.minuteStart).toISOString().slice(0, 19).replace('T', ' '),
        open: current.open,
        high: Math.max(current.high, close),
        low: Math.min(current.low, close),
        close
      };
      completed.set(finalized.datetime, finalized);
      while (completed.size > 220) completed.delete(completed.keys().next().value);
    }
    // A gap larger than one minute resets the baseline; missing candles are never invented.
    startBar(minuteStart, price, timestamp);
    return finalized;
  }

  return {
    ingest,
    getCompletedCandles: () => Array.from(completed.values()),
    getCurrentCandle: () => current ? {
      datetime: new Date(current.minuteStart).toISOString().slice(0, 19).replace('T', ' '),
      open: current.open, high: current.high, low: current.low, close: current.close,
      ticks: current.ticks,
      direction: current.close > current.open ? 'BULLISH' :
        current.close < current.open ? 'BEARISH' : 'NEUTRAL'
    } : null
  };
}

function gateForecastWithLiveCandle(forecast, liveCandle, now = Date.now()) {
  if (!forecast || (forecast.signal !== 'CALL' && forecast.signal !== 'PUT')) return forecast;
  const currentMinute = Math.floor(now / 60000) * 60000;
  const nextMinute = Date.parse(forecast.nextCandleAt || '');
  const decisionAge = now - currentMinute;
  if (!Number.isFinite(nextMinute) || nextMinute !== currentMinute || decisionAge < 0 || decisionAge > 12000) {
    return { ...forecast, signal:'STANDBY', reason:'สัญญาณไม่ตรงกับแท่ง M1 ที่กำลังเปิดหรือมาช้าเกินไป · STANDBY' };
  }
  if (!liveCandle || liveCandle.ticks < 2) {
    return { ...forecast, signal:'STANDBY', reason:'รอ tick สดอย่างน้อย 2 จุดเพื่อยืนยันทิศทางแท่ง M1 ปัจจุบัน · STANDBY' };
  }
  const liveStart = Date.parse(String(liveCandle.datetime || '').replace(' ','T') + 'Z');
  if (!Number.isFinite(liveStart) || liveStart !== currentMinute) {
    return { ...forecast, signal:'STANDBY', reason:'แท่งสดไม่ตรงกับนาทีปัจจุบัน · STANDBY' };
  }
  const aligned = forecast.signal === 'CALL'
    ? liveCandle.direction === 'BULLISH'
    : liveCandle.direction === 'BEARISH';
  if (!aligned) {
    return { ...forecast, signal:'STANDBY', reason:'ทิศทางแท่ง M1 สดสวนกับสัญญาณ · งดเข้าออเดอร์ · STANDBY' };
  }
  return forecast;
}

function createLiveEngine(apiKey, getClosedCandles) {
  let socket = null, status = apiKey ? 'connecting' : 'unavailable';
  let message = apiKey ? 'กำลังเชื่อมต่อ Twelve Data WebSocket' : 'ยังไม่มี API key';
  let tick = null, retryTimer = null, heartbeatTimer = null, retryDelay = 5000, stopped = false;
  let evaluatedCandleKey = null, cachedForecast = null;
  const tickCandles = createMinuteCandleAggregator();

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
          tick = { price, timestamp };
          tickCandles.ingest(price, timestamp);
          status = 'subscribed'; message = 'รับราคาสด EUR/USD';
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

  function getMergedClosedCandles() {
    const merged = new Map();
    for (const candle of getClosedCandles()) merged.set(String(candle.datetime), candle);
    // REST OHLC wins for any minute it has. Tick-derived bars fill only the latest REST gap.
    for (const candle of tickCandles.getCompletedCandles()) {
      if (!merged.has(candle.datetime)) merged.set(candle.datetime, candle);
    }
    return Array.from(merged.values())
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .slice(-220);
  }

  function prediction() {
    const candles = getMergedClosedCandles();
    const last = candles.at(-1);
    const key = last && [last.datetime, last.open, last.high, last.low, last.close].join(':');
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
    const liveCandle = tickCandles.getCurrentCandle();
    forecast = gateForecastWithLiveCandle(forecast, liveCandle, Date.now());
    const tickAge = tick ? Date.now() - tick.timestamp : Infinity;
    return {
      symbol:'EUR/USD', prediction:forecast.signal, forecast, streamStatus:status,
      price:tick && tickAge <= 75000 ? tick.price.toFixed(5) : '—',
      dataAgeSeconds:Number.isFinite(tickAge) ? Math.max(0,Math.floor(tickAge/1000)) : null,
      timestamp:tick ? new Date(tick.timestamp).toISOString() : null,
      lastClosedCandle:last ? last.datetime : null,
      closedCandleAgeSeconds:Number.isFinite(age) ? Math.max(0,Math.floor(age/1000)) : null,
      liveCandle,
      reason:forecast.reason, ema5:forecast.indicators && forecast.indicators.ema5,
      ema20:forecast.indicators && forecast.indicators.ema20,
      rsi:forecast.indicators && forecast.indicators.rsi14
    };
  }
  connect();
  return {
    prediction, getStatus:()=>({status,message}),
    stop:()=>{stopped=true;clearTimeout(retryTimer);clearInterval(heartbeatTimer);if(socket)socket.close();}
  };
}
module.exports = { createLiveEngine, createMinuteCandleAggregator, gateForecastWithLiveCandle };
