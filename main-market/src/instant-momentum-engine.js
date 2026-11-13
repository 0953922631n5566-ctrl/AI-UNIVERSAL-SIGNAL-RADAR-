const CONTEXT_CANDLES = 50;
const ENTRY_CANDLES = 4;
const REQUIRED_CLOSED_CANDLES = CONTEXT_CANDLES + ENTRY_CANDLES;
const LIVE_M1_WINDOW_MS = 60_000;
const MAX_TICK_AGE_SECONDS = 5;
const MAX_EVENT_AGE_SECONDS = 60;
const MIN_PRICE_MOVE = 0.00001;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function atr14(candles) {
  const rows = candles.slice(-15);
  const ranges = rows.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - rows[index].close),
    Math.abs(candle.low - rows[index].close)
  ));
  return mean(ranges);
}

function validCandle(candle) {
  return Boolean(candle &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low);
}

/** Aggressive live-M1 engine: 50 context + 4 entry candles, evaluated on every fresh tick. */
export function analyzeInstantMomentum({ candles, now = Date.now(), tickAgeSeconds, tickEventAt } = {}) {
  const all = Array.isArray(candles) ? candles : [];
  const live = all.at(-1);
  if (!live || live.live !== true || !validCandle(live)) return standby("รอแท่ง M1 ปัจจุบันและราคา Streaming สด");

  const eventAt = Number.isFinite(tickEventAt) ? tickEventAt : now;
  const eventAgeMs = now - eventAt;
  if (!Number.isFinite(eventAgeMs) || eventAgeMs < 0 || eventAgeMs > MAX_EVENT_AGE_SECONDS * 1000) {
    return standby("Timestamp ต้นทางของ Streaming อยู่นอกช่วงเวลาแท่ง M1 ปัจจุบัน");
  }
  const elapsedMs = eventAt - live.epoch * 1000;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= LIVE_M1_WINDOW_MS) {
    return standby("แท่ง M1 ปัจจุบันหมดช่วงวิเคราะห์แล้ว");
  }
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds < 0 || tickAgeSeconds > MAX_TICK_AGE_SECONDS) {
    return standby("ราคา Streaming ต้องสดไม่เกิน 5 วินาที");
  }

  const closed = all.filter(c => c && c.live !== true && Number.isFinite(c.epoch) && c.epoch < live.epoch);
  const window = closed.slice(-REQUIRED_CLOSED_CANDLES);
  const entry = window.slice(-ENTRY_CANDLES);
  if (window.length < REQUIRED_CLOSED_CANDLES || !window.every(validCandle)) {
    return standby(`ข้อมูลแท่งปิดไม่ครบ 54 แท่ง (${window.length}/54)`);
  }
  if (window.some((c, i) => i > 0 && c.epoch <= window[i - 1].epoch)) return standby("ลำดับเวลาแท่ง M1 ไม่ถูกต้อง");

  const atr = atr14(window);
  if (!(atr > 0)) return standby("ATR ของข้อมูลอ้างอิงไม่เพียงพอ");
  const body = live.close - live.open;
  const range = Math.max(0, live.high - live.low);
  const bodyAbs = Math.abs(body);
  const bodyRatio = range > 0 ? bodyAbs / range : 0;
  const impulseThreshold = Math.max(atr * 0.10, MIN_PRICE_MOVE);
  const breakoutBuffer = Math.max(atr * 0.015, 0.000003);
  const priorHigh = Math.max(...entry.map(c => c.high));
  const priorLow = Math.min(...entry.map(c => c.low));
  const previousClose = entry.at(-1).close;

  const bullishCloseStrong = live.close > live.open && (live.high - live.close) <= Math.max(range * 0.40, atr * 0.05);
  const bearishCloseStrong = live.close < live.open && (live.close - live.low) <= Math.max(range * 0.40, atr * 0.05);
  const bullishMomentum = body >= impulseThreshold && bodyRatio >= 0.32 && bullishCloseStrong;
  const bearishMomentum = -body >= impulseThreshold && bodyRatio >= 0.32 && bearishCloseStrong;
  const bullishBreakout = live.close > priorHigh + breakoutBuffer && body > 0 &&
    bodyAbs >= Math.max(atr * 0.04, MIN_PRICE_MOVE * 0.5);
  const bearishBreakout = live.close < priorLow - breakoutBuffer && body < 0 &&
    bodyAbs >= Math.max(atr * 0.04, MIN_PRICE_MOVE * 0.5);
  const bullishContinuation = body > 0 && live.close > previousClose &&
    bodyAbs >= Math.max(atr * 0.06, MIN_PRICE_MOVE * 0.5) && bodyRatio >= 0.25;
  const bearishContinuation = body < 0 && live.close < previousClose &&
    bodyAbs >= Math.max(atr * 0.06, MIN_PRICE_MOVE * 0.5) && bodyRatio >= 0.25;

  const call = bullishMomentum || bullishBreakout || bullishContinuation;
  const put = bearishMomentum || bearishBreakout || bearishContinuation;
  const metrics = {
    elapsedMs: Math.round(elapsedMs), tickAgeSeconds, atr14: atr, openingBody: body,
    bodyToRange: bodyRatio, priorFourHigh: priorHigh, priorFourLow: priorLow,
    bullishMomentum, bearishMomentum, bullishBreakout, bearishBreakout,
    bullishContinuation, bearishContinuation, riskLevel: "HIGH", mode: "AGGRESSIVE_LIVE_M1"
  };
  if (call && !put) {
    const setupType = bullishBreakout ? "BREAKOUT" : bullishMomentum ? "MOMENTUM" : "CONTINUATION";
    const reason = setupType === "BREAKOUT" ? "โหมดรุก: แรงซื้อทะลุ High ของ 4 แท่งก่อนหน้า"
      : setupType === "MOMENTUM" ? "โหมดรุก: ตรวจพบแรงซื้อและโมเมนตัมในแท่ง M1 ปัจจุบัน"
      : "โหมดรุก: ราคายืนเหนือแท่งก่อนพร้อมแรงซื้อเดินหน้าต่อ";
    return directional("CALL", "BULLISH_" + setupType, reason, setupType, metrics, now);
  }
  if (put && !call) {
    const setupType = bearishBreakout ? "BREAKOUT" : bearishMomentum ? "MOMENTUM" : "CONTINUATION";
    const reason = setupType === "BREAKOUT" ? "โหมดรุก: แรงขายทะลุ Low ของ 4 แท่งก่อนหน้า"
      : setupType === "MOMENTUM" ? "โหมดรุก: ตรวจพบแรงขายและโมเมนตัมในแท่ง M1 ปัจจุบัน"
      : "โหมดรุก: ราคายืนใต้แท่งก่อนพร้อมแรงขายเดินหน้าต่อ";
    return directional("PUT", "BEARISH_" + setupType, reason, setupType, metrics, now);
  }
  return standby(call && put ? "แรงซื้อและแรงขายขัดแย้งกัน — ไม่ฝืนเลือกทิศทาง"
    : "ยังไม่พบ Momentum, Breakout หรือ Continuation ที่เข้าเกณฑ์", metrics);
}

function directional(signal, regime, reason, setupType, metrics, now) {
  return {
    signal, direction: signal, regime, reason, summary: reason,
    strategy: "AGGRESSIVE_MOMENTUM_BREAKOUT", provider: "LOCAL_LIVE_TICK_ENGINE",
    entryType: "LIVE_M1_INTRAMINUTE", setupType, riskLevel: "HIGH",
    confidence: null, score: null,
    evidence: [reason, "ใช้แท่งปิด 50 แท่งบริบท + 4 แท่งล่าสุด", "วิเคราะห์ Streaming สดได้ตลอดแท่ง M1"],
    riskFlags: ["HIGH_RISK_EARLY_ENTRY"], metrics, analyzedAt: new Date(now).toISOString()
  };
}

function standby(reason, metrics = null) {
  return {
    signal: "STANDBY", direction: null, regime: "UNCLEAR", reason, summary: reason,
    strategy: "AGGRESSIVE_MOMENTUM_BREAKOUT", provider: "LOCAL_LIVE_TICK_ENGINE",
    entryType: "LIVE_M1_INTRAMINUTE", confidence: null, score: null,
    evidence: [], riskFlags: [reason], metrics, analyzedAt: new Date().toISOString()
  };
}

export const INSTANT_ENGINE_CONFIG = Object.freeze({
  contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES,
  requiredClosedCandles: REQUIRED_CLOSED_CANDLES, liveM1WindowMs: LIVE_M1_WINDOW_MS,
  maxTickAgeSeconds: MAX_TICK_AGE_SECONDS, maxEventAgeSeconds: MAX_EVENT_AGE_SECONDS, mode: "AGGRESSIVE_LIVE_M1", riskLevel: "HIGH"
});
