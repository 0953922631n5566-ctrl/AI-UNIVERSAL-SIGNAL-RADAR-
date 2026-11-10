import {
  MIN_CLOSED_CANDLES, CONTEXT_CANDLES, ENTRY_CANDLES,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS
} from "./config.js";

function sourceGate(candles, options) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const closed = Array.isArray(candles)
    ? candles.filter(c => c && c.live !== true && Number.isFinite(c.epoch) &&
        c.epoch < Math.floor(now / 60000) * 60)
    : [];
  const last = closed.at(-1) || null;
  const ageSeconds = last ? Math.max(0, now / 1000 - (last.epoch + 60)) : Infinity;
  const stream = Number.isFinite(options.tickAgeSeconds) &&
    options.tickAgeSeconds >= 0 && options.tickAgeSeconds <= MAX_STREAM_AGE_SECONDS;
  const rest = options.allowRestFallback === true && ageSeconds <= MAX_CANDLE_AGE_SECONDS;
  const enough = closed.length >= MIN_CLOSED_CANDLES;
  const window = closed.slice(-MIN_CLOSED_CANDLES);
  const validOHLC = enough && window.every(c =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.close > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low
  );
  const ordered = window.every((c, i) => i === 0 || c.epoch > window[i - 1].epoch);
  const reason = !enough ? `Insufficient closed M1 candles (${closed.length}/${MIN_CLOSED_CANDLES})`
    : !validOHLC ? "Invalid OHLC candle data"
    : !ordered ? "Candle timestamps are not strictly increasing"
    : ageSeconds > MAX_CANDLE_AGE_SECONDS ? "Latest closed candle is stale"
    : !stream && !rest ? "No fresh Streaming tick or permitted fresh REST fallback"
    : null;
  return {
    ready: !reason, reason, mode: stream ? "STREAMING" : rest ? "REST_FALLBACK" : "UNAVAILABLE",
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    lastCandleEpoch: last?.epoch ?? null, closed
  };
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  let current = values[0];
  const output = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

function decision(signal, regime, reason, evidence, metrics, confidence = 70) {
  return {
    signal, regime, confidence, score: confidence, reason, evidence, riskFlags: [],
    summary: reason, strategy: "EMA_5_20_WICK_REJECTION", entryType: "EMA5_WICK_REJECTION",
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/**
 * Closed-candle M1 EMA 5/20 Wick Rejection:
 * - EMA 20 defines the directional zone (close above = CALL; below = PUT).
 * - The completed candle must pull back through/touch EMA 5 and close back
 *   on the trend side with a directional body and a meaningful rejection wick.
 * - Existing source-quality and T-5 timing guards remain outside this engine.
 */
export function calculatePureTechnicalSignal(candles) {
  if (!Array.isArray(candles) || candles.length < 21) {
    return { signal: "STANDBY", reason: "ต้องมีแท่งปิดอย่างน้อย 21 แท่งเพื่อคำนวณ EMA 20", evidence: [] };
  }
  if (!candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return { signal: "STANDBY", reason: "ข้อมูล OHLC ไม่ถูกต้อง", evidence: [] };
  }

  const closes = candles.map(c => c.close);
  const ema5 = emaSeries(closes, 5);
  const ema20 = emaSeries(closes, 20);
  const index = closes.length - 1;
  const candle = candles[index];
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const lowerWick = Math.max(0, Math.min(candle.open, candle.close) - candle.low);
  const upperWick = Math.max(0, candle.high - Math.max(candle.open, candle.close));
  const safeBody = Math.max(body, range * 0.02, Number.EPSILON);
  const lowerWickBodyRatio = lowerWick / safeBody;
  const upperWickBodyRatio = upperWick / safeBody;
  const lowerWickRangeRatio = range > 0 ? lowerWick / range : 0;
  const upperWickRangeRatio = range > 0 ? upperWick / range : 0;
  const bullishZone = candle.close > ema20[index];
  const bearishZone = candle.close < ema20[index];
  const touchedEma5 = candle.low <= ema5[index] && candle.high >= ema5[index];
  const bullishRejection = bullishZone && touchedEma5 &&
    candle.open > ema5[index] && candle.close > ema5[index] &&
    candle.close > candle.open &&
    lowerWickBodyRatio >= 1.0 && lowerWickRangeRatio >= 0.25;
  const bearishRejection = bearishZone && touchedEma5 &&
    candle.open < ema5[index] && candle.close < ema5[index] &&
    candle.close < candle.open &&
    upperWickBodyRatio >= 1.0 && upperWickRangeRatio >= 0.25;

  const metrics = {
    ema5: ema5[index], ema20: ema20[index],
    emaFast: ema5[index], emaSlow: ema20[index], trendEma: ema20[index],
    wickTouchEma5: touchedEma5,
    lowerWickBodyRatio: Number(lowerWickBodyRatio.toFixed(3)),
    upperWickBodyRatio: Number(upperWickBodyRatio.toFixed(3)),
    lowerWickRangeRatio: Number(lowerWickRangeRatio.toFixed(3)),
    upperWickRangeRatio: Number(upperWickRangeRatio.toFixed(3)),
    candleBody: body, candleRange: range
  };

  if (bullishRejection) {
    return decision("CALL", "UPTREND",
      "EMA 5/20 Wick Rejection: ราคาอยู่เหนือ EMA 20 ย่อลงแตะ EMA 5 แล้วปิดเขียวกลับเหนือ EMA 5 พร้อมไส้ล่างปฏิเสธราคา",
      ["Close > EMA 20 (โซน CALL)", "Low แตะ/ผ่าน EMA 5 และ Close กลับเหนือ EMA 5", "แท่งปิดเขียว", "ไส้ล่างยาวอย่างน้อย 1 เท่าของ Body และ 25% ของช่วงแท่ง"],
      metrics, 72);
  }
  if (bearishRejection) {
    return decision("PUT", "DOWNTREND",
      "EMA 5/20 Wick Rejection: ราคาอยู่ใต้ EMA 20 ดีดขึ้นแตะ EMA 5 แล้วปิดแดงกลับใต้ EMA 5 พร้อมไส้บนปฏิเสธราคา",
      ["Close < EMA 20 (โซน PUT)", "High แตะ/ผ่าน EMA 5 และ Close กลับใต้ EMA 5", "แท่งปิดแดง", "ไส้บนยาวอย่างน้อย 1 เท่าของ Body และ 25% ของช่วงแท่ง"],
      metrics, 72);
  }

  let reason = "ยังไม่พบแท่งปิดที่แตะ EMA 5 และเกิด Wick Rejection ในโซน EMA 20";
  if (!bullishZone && !bearishZone) reason = "ราคาอยู่ใกล้ EMA 20 — ยังไม่เลือกทิศทาง";
  else if (bullishZone && touchedEma5) reason = "อยู่โซน CALL และแตะ EMA 5 แล้ว แต่ไส้ล่าง/แท่งปิดยังไม่ยืนยัน Rejection";
  else if (bearishZone && touchedEma5) reason = "อยู่โซน PUT และแตะ EMA 5 แล้ว แต่ไส้บน/แท่งปิดยังไม่ยืนยัน Rejection";
  return {
    signal: "STANDBY", regime: bullishZone ? "UPTREND" : bearishZone ? "DOWNTREND" : "UNCLEAR",
    confidence: 0, score: 0, reason,
    evidence: [`EMA 5: ${ema5[index]}`, `EMA 20: ${ema20[index]}`, touchedEma5 ? "แท่งล่าสุดแตะ EMA 5" : "แท่งล่าสุดยังไม่แตะ EMA 5"],
    riskFlags: [], summary: reason, strategy: "EMA_5_20_WICK_REJECTION",
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/** Data quality/timing guards are unchanged; direction is decided locally. */
export async function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  const base = {
    lastCandleEpoch: gate.lastCandleEpoch, dataMode: gate.mode,
    ageSeconds: gate.ageSeconds, livePriceReady: gate.ready,
    closedCandleCount: gate.closed.length, requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES }
  };
  if (!gate.ready) {
    return {
      signal: "STANDBY", reason: gate.reason, regime: "UNCLEAR", score: 0,
      confidence: 0, strategy: "SOURCE_QUALITY_GUARD", provider: "SYSTEM_GUARD",
      evidence: [], riskFlags: [gate.reason], ...base
    };
  }
  const decisionResult = calculatePureTechnicalSignal(gate.closed.slice(-MIN_CLOSED_CANDLES));
  return {
    ...decisionResult, ...base,
    evidence: Array.isArray(decisionResult.evidence) ? decisionResult.evidence : [],
    analyzedAt: new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(),
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES },
    signalReleaseStatus: "EMA_5_20_WICK_REJECTION_MANUAL_ONLY_NOT_OOS_VALIDATED"
  };
}

export { sourceGate };
