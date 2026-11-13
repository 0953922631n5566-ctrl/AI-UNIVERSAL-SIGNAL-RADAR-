const CONTEXT_CANDLES = 50;
const ENTRY_CANDLES = 4;
const REQUIRED_CLOSED_CANDLES = CONTEXT_CANDLES + ENTRY_CANDLES;
const OPENING_WINDOW_MS = 5_000;
const MAX_TICK_AGE_SECONDS = 5;
const MIN_PRICE_MOVE = 0.00002;

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

/**
 * Opening-window M1 decision engine.
 * Uses 50 closed M1 context candles plus the latest four closed entry candles, and the current
 * live candle's first 0–5 seconds for the actual momentum/breakout trigger.
 * It deliberately does not force a direction when the opening move is weak
 * or contradictory.
 */
export function analyzeInstantMomentum({ candles, now = Date.now(), tickAgeSeconds, tickEventAt } = {}) {
  const all = Array.isArray(candles) ? candles : [];
  const live = all.at(-1);
  if (!live || live.live !== true || !validCandle(live)) {
    return standby("รอแท่ง M1 ใหม่และราคา Streaming สด");
  }

  const eventAt = Number.isFinite(tickEventAt) ? tickEventAt : now;
  const eventAgeMs = now - eventAt;
  if (!Number.isFinite(eventAgeMs) || eventAgeMs < 0 || eventAgeMs > OPENING_WINDOW_MS) {
    return standby("Timestamp ต้นทางของ Streaming เก่ากว่า 5 วินาที");
  }
  const elapsedMs = eventAt - live.epoch * 1000;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= OPENING_WINDOW_MS) {
    return standby("พ้นช่วงวิเคราะห์ต้นแท่ง M1 0–5 วินาที");
  }
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds < 0 ||
      tickAgeSeconds > MAX_TICK_AGE_SECONDS) {
    return standby("ราคา Streaming ต้องสดไม่เกิน 5 วินาที");
  }

  const closed = all.filter(c => c && c.live !== true &&
    Number.isFinite(c.epoch) && c.epoch < live.epoch);
  const window = closed.slice(-REQUIRED_CLOSED_CANDLES);
  const context = window.slice(0, CONTEXT_CANDLES);
  const entry = window.slice(-ENTRY_CANDLES);
  if (window.length < REQUIRED_CLOSED_CANDLES || !window.every(validCandle)) {
    return standby(`ข้อมูลแท่งปิดไม่ครบ 54 แท่ง (${window.length}/54)`);
  }
  if (window.some((c, i) => i > 0 && c.epoch <= window[i - 1].epoch)) {
    return standby("ลำดับเวลาแท่ง M1 ไม่ถูกต้อง");
  }

  const atr = atr14(window);
  if (!(atr > 0)) return standby("ATR ของข้อมูลอ้างอิงไม่เพียงพอ");
  const body = live.close - live.open;
  const range = Math.max(0, live.high - live.low);
  const bodyAbs = Math.abs(body);
  const bodyRatio = range > 0 ? bodyAbs / range : 0;
  const impulseThreshold = Math.max(atr * 0.18, MIN_PRICE_MOVE);
  const breakoutBuffer = Math.max(atr * 0.02, 0.000005);
  const prior = entry;
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));

  const bullishCloseStrong = live.close > live.open &&
    (live.high - live.close) <= Math.max(range * 0.25, atr * 0.04);
  const bearishCloseStrong = live.close < live.open &&
    (live.close - live.low) <= Math.max(range * 0.25, atr * 0.04);

  const bullishMomentum = body >= impulseThreshold && bodyRatio >= 0.55 && bullishCloseStrong;
  const bearishMomentum = -body >= impulseThreshold && bodyRatio >= 0.55 && bearishCloseStrong;
  const bullishBreakout = live.close > priorHigh + breakoutBuffer &&
    body > 0 && bodyAbs >= Math.max(atr * 0.08, MIN_PRICE_MOVE * 0.5);
  const bearishBreakout = live.close < priorLow - breakoutBuffer &&
    body < 0 && bodyAbs >= Math.max(atr * 0.08, MIN_PRICE_MOVE * 0.5);

  const call = bullishMomentum || bullishBreakout;
  const put = bearishMomentum || bearishBreakout;
  const metrics = {
    elapsedMs: Math.round(elapsedMs),
    tickAgeSeconds,
    atr14: atr,
    openingBody: body,
    bodyToRange: bodyRatio,
    priorFourHigh: priorHigh,
    priorFourLow: priorLow,
    bullishMomentum,
    bearishMomentum,
    bullishBreakout,
    bearishBreakout
  };

  if (call && !put) {
    const reason = bullishBreakout && bullishMomentum
      ? "แรงซื้อเปิดแท่งพร้อมทะลุ High ของ 4 แท่ง M1 ก่อนหน้า"
      : bullishBreakout ? "แรงซื้อทะลุ High ของ 4 แท่ง M1 ก่อนหน้า"
      : "ตรวจพบแรงซื้อกระชากในช่วงเปิดแท่ง M1";
    return {
      signal: "CALL", direction: "CALL", regime: "BULLISH_IMPULSE",
      reason, summary: reason, strategy: "INSTANT_MOMENTUM_BREAKOUT",
      provider: "LOCAL_LIVE_TICK_ENGINE", entryType: "M1_OPEN_0_5S",
      confidence: null, score: null, evidence: [reason, "ใช้แท่งปิด 50 แท่งบริบท + 4 แท่งล่าสุดเป็น entry context", "ใช้ราคา Streaming ของแท่งปัจจุบันเท่านั้น"],
      riskFlags: [], metrics, analyzedAt: new Date(now).toISOString()
    };
  }
  if (put && !call) {
    const reason = bearishBreakout && bearishMomentum
      ? "แรงขายเปิดแท่งพร้อมทะลุ Low ของ 4 แท่ง M1 ก่อนหน้า"
      : bearishBreakout ? "แรงขายทะลุ Low ของ 4 แท่ง M1 ก่อนหน้า"
      : "ตรวจพบแรงขายกระชากในช่วงเปิดแท่ง M1";
    return {
      signal: "PUT", direction: "PUT", regime: "BEARISH_IMPULSE",
      reason, summary: reason, strategy: "INSTANT_MOMENTUM_BREAKOUT",
      provider: "LOCAL_LIVE_TICK_ENGINE", entryType: "M1_OPEN_0_5S",
      confidence: null, score: null, evidence: [reason, "ใช้แท่งปิด 50 แท่งเป็นบริบท", "ใช้ราคา Streaming ของแท่งปัจจุบันเท่านั้น"],
      riskFlags: [], metrics, analyzedAt: new Date(now).toISOString()
    };
  }
  return standby(call && put
    ? "แรงซื้อและแรงขายขัดแย้งกันในช่วงเปิดแท่ง — ไม่ฝืนเลือกทิศทาง"
    : "ยังไม่พบ Momentum หรือ Breakout ที่ชัดเจนใน 5 วินาทีแรก", metrics);
}

function standby(reason, metrics = null) {
  return {
    signal: "STANDBY", direction: null, regime: "OPENING_WINDOW_UNCONFIRMED",
    reason, summary: reason, strategy: "INSTANT_MOMENTUM_BREAKOUT",
    provider: "LOCAL_LIVE_TICK_ENGINE", entryType: "M1_OPEN_0_5S",
    confidence: null, score: null, evidence: [], riskFlags: [reason],
    metrics, analyzedAt: new Date().toISOString()
  };
}

export const INSTANT_ENGINE_CONFIG = Object.freeze({
  contextCandles: CONTEXT_CANDLES,
  entryCandles: ENTRY_CANDLES,
  requiredClosedCandles: REQUIRED_CLOSED_CANDLES,
  openingWindowMs: OPENING_WINDOW_MS,
  maxTickAgeSeconds: MAX_TICK_AGE_SECONDS
});
