const WebSocket = require('ws');
const { evaluateLiveFormula } = require('./forecast-engine');

// Aggregate only real Twelve Data quotes. Missing minutes are never fabricated.
function createMinuteCandleAggregator() {
  let current = null;
  const completed = new Map();
  function startBar(minuteStart, price, timestamp) {
    current = { minuteStart, open: price, high: price, low: price, close: price, ticks: 1, lastTimestamp: timestamp };
  }
  function ingest(price, timestamp) {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return null;
    const minuteStart = Math.floor(timestamp / 60000) * 60000;
    if (!current) { startBar(minuteStart, price, timestamp); return null; }
    if (minuteStart < current.minuteStart || timestamp < current.lastTimestamp) return null;
    if (minuteStart === current.minuteStart) {
      current.high = Math.max(current.high, price); current.low = Math.min(current.low, price);
      current.close = price; current.ticks += 1; current.lastTimestamp = timestamp; return null;
    }
    let finalized = null;
    if (minuteStart === current.minuteStart + 60000) {
      const close = current.ticks > 1 ? current.close : price;
      finalized = {
        datetime: new Date(current.minuteStart).toISOString().slice(0, 19).replace('T', ' '),
        open: current.open, high: Math.max(current.high, close),
        low: Math.min(current.low, close), close
      };
      completed.set(finalized.datetime, finalized);
      while (completed.size > 220) completed.delete(completed.keys().next().value);
    }
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
      direction: current.close > current.open ? 'BULLISH' : current.close < current.open ? 'BEARISH' : 'NEUTRAL'
    } : null
  };
}

function createLiveEngine(apiKey, getClosedCandles) {
  let socket = null, status = apiKey ? 'connecting' : 'unavailable';
  let message = apiKey ? 'กำลังเชื่อมต่อ Twelve Data WebSocket' : 'ยังไม่มี API key';
  let tick = null, previousTickPrice = null, retryTimer = null, heartbeatTimer = null;
  let retryDelay = 5000, stopped = false;
  const tickCandles = createMinuteCandleAggregator();
  const signalState = { signal: 'WAIT', signalAt: null, expiresAt: 0, minuteKey: null };
  let latestAnalysis = null;

  function mergedClosedCandles() {
    const merged = new Map();
    for (const candle of getClosedCandles()) merged.set(String(candle.datetime), candle);
    for (const candle of tickCandles.getCompletedCandles()) if (!merged.has(candle.datetime)) merged.set(candle.datetime, candle);
    return Array.from(merged.values()).sort((a,b) => a.datetime.localeCompare(b.datetime)).slice(-220);
  }

  function processSignal() {
    const now = Date.now();
    if (signalState.signal !== 'WAIT' && now >= signalState.expiresAt) {
      signalState.signal = 'WAIT'; signalState.signalAt = null; signalState.expiresAt = 0; signalState.minuteKey = null;
    }
    const tickAge = tick ? now - tick.timestamp : Infinity;
    if (!tick || tickAge < 0 || tickAge > 30000 || status !== 'subscribed') {
      latestAnalysis = { ready:false, signal:'WAIT', statusText:'DANGER', statusColor:'red',
        confidence:'50.0', rsi:50, trend:'NEUTRAL', trendLabel:'รอข้อมูล',
        reason:'ราคาสดขาดหายหรือเก่าเกิน 30 วินาที · STANDBY' };
      return;
    }
    const candles = mergedClosedCandles();
    const analysis = evaluateLiveFormula(candles, tick.price, previousTickPrice, now);
    latestAnalysis = analysis;
    if (!analysis.ready || (analysis.isSideway && analysis.candidate === 'WAIT')) return;
    const minuteKey = Math.floor(now / 60000);
    if (signalState.signal === 'WAIT' && signalState.minuteKey !== minuteKey &&
        analysis.exactTimeLeft <= 5.0 && analysis.exactTimeLeft >= 0) {
      if (analysis.candidate === 'CALL' || analysis.candidate === 'PUT') {
        signalState.signal = analysis.candidate;
        signalState.signalAt = now;
        signalState.expiresAt = now + 35000;
        signalState.minuteKey = minuteKey;
      }
    }
  }

  function connect() {
    if (stopped || !apiKey || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
    clearTimeout(retryTimer); status = 'connecting';
    const ws = new WebSocket('wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(apiKey));
    socket = ws;
    ws.on('open', () => {
      status = 'authorizing'; message = 'เชื่อมต่อแล้ว กำลังขอราคาสด EUR/USD';
      ws.send(JSON.stringify({ action:'subscribe', params:{ symbols:'EUR/USD' } }));
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({action:'heartbeat'})); }, 10000);
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
          previousTickPrice = tick ? tick.price : null;
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

  function prediction() {
    processSignal();
    const candles = mergedClosedCandles(), last = candles.at(-1);
    const closedAt = last ? Date.parse(String(last.datetime).replace(' ','T')+'Z') + 60000 : NaN;
    const closedAge = Number.isFinite(closedAt) ? Date.now() - closedAt : Infinity;
    const tickAge = tick ? Date.now() - tick.timestamp : Infinity;
    const active = signalState.signal === 'CALL' || signalState.signal === 'PUT';
    const visibleSignal = active ? signalState.signal : 'STANDBY';
    const analysis = latestAnalysis || { confidence:'50.0', rsi:50, trend:'NEUTRAL', trendLabel:'รอข้อมูล', statusText:'DANGER', reason:'รอข้อมูลจริง' };
    const remaining = active ? Math.max(0, Math.ceil((signalState.expiresAt - Date.now()) / 1000)) : 0;
    const forecast = {
      signal: visibleSignal, displayState: analysis.regime || (analysis.isSideway ? 'SIDEWAY' : visibleSignal),
      confidence: analysis.confidence, agreementScore: Number(analysis.confidence),
      agreementVotes: analysis.ready ? 'FORMULA' : 'WAIT',
      horizon: 0, validFor: 'CURRENT_M1_FINAL_5_SECONDS',
      signalAt: signalState.signalAt, signalMinuteKey: signalState.minuteKey,
      holdSeconds: remaining, trend: analysis.trend, trendLabel: analysis.trendLabel, regime: analysis.regime,
      candleDirection: tickCandles.getCurrentCandle()?.direction || 'NEUTRAL',
      candleLabel: tickCandles.getCurrentCandle()?.direction || 'NEUTRAL',
      indicators: { ema5: analysis.ema5, ema20: analysis.ema20, rsi14: analysis.rsi, bollingerBandwidth: analysis.bandwidth },
      statusText: analysis.statusText, statusColor: analysis.statusColor,
      reason: active ? 'สัญญาณ ' + visibleSignal + ' · ล็อก 35 วินาที'
        : analysis.reason
    };
    return {
      symbol:'EUR/USD', prediction:visibleSignal, forecast, streamStatus:status,
      streamMessage:message, price:tick && tickAge <= 75000 ? tick.price.toFixed(5) : '—',
      dataAgeSeconds:Number.isFinite(tickAge) ? Math.max(0,Math.floor(tickAge/1000)) : null,
      timestamp:tick ? new Date(tick.timestamp).toISOString() : null,
      lastClosedCandle:last ? last.datetime : null,
      closedCandleAgeSeconds:Number.isFinite(closedAge) ? Math.max(0,Math.floor(closedAge/1000)) : null,
      liveCandle:tickCandles.getCurrentCandle(), signalAt:signalState.signalAt,
      signalMinuteKey:signalState.minuteKey, holdSeconds:remaining,
      confidence:analysis.confidence, rsi:analysis.rsi, trend:analysis.trend,
      statusText:analysis.statusText, statusColor:analysis.statusColor,
      reason:forecast.reason
    };
  }

  connect();
  const engineTimer = setInterval(processSignal, 100);
  return {
    prediction, getStatus:()=>({status,message}),
    stop:()=>{stopped=true;clearInterval(engineTimer);clearTimeout(retryTimer);clearInterval(heartbeatTimer);if(socket)socket.close();}
  };
}

module.exports = { createLiveEngine, createMinuteCandleAggregator };
