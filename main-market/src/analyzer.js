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
    summary: reason, strategy: "EMA_5_20_RELAXED_TREND_FLOW", entryType: "EMA5_TREND_FLOW",
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/**
 * Closed-candle M1 EMA 5/20 Relaxed Proximity & Trend Flow:
 * - EMA 20 defines the directional zone.
 * - EMA 5 slope plus EMA 20 slope confirm trend flow.
 * - Price need only be near EMA 5 (ATR-scaled); exact touch and wick shape are not required.
 * - A directional close / progress versus the prior close confirms momentum.
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
  const previous = candles[index - 1];
  const candle = candles[index];
  const trueRanges = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low - candles[i].close)
  ));
  const atrWindow = trueRanges.slice(-14);
  const atr14 = atrWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, atrWindow.length);
  const proximityLimit = Math.max(atr14 * 0.35, Math.abs(candle.close) * 0.00001);
  const distanceToEma5 = ema5[index] < candle.low ? candle.low - ema5[index]
    : ema5[index] > candle.high ? ema5[index] - candle.high : 0;
  const nearEma5 = distanceToEma5 <= proximityLimit;
  const bullishZone = candle.close > ema20[index];
  const bearishZone = candle.close < ema20[index];
  const ema5Rising = ema5[index] > ema5[index - 1];
  const ema5Falling = ema5[index] < ema5[index - 1];
  const ema20Rising = ema20[index] > ema20[index - 1];
  const ema20Falling = ema20[index] < ema20[index - 1];
  const bullishMomentum = candle.close > candle.open || candle.close > previous.close;
  const bearishMomentum = candle.close < candle.open || candle.close < previous.close;
  const bullishFlow = bullishZone && candle.close > ema5[index] && nearEma5 &&
    ema5Rising && ema20Rising && bullishMomentum;
  const bearishFlow = bearishZone && candle.close < ema5[index] && nearEma5 &&
    ema5Falling && ema20Falling && bearishMomentum;

  const metrics = {
    ema5: ema5[index], ema20: ema20[index],
    emaFast: ema5[index], emaSlow: ema20[index], trendEma: ema20[index],
    atr14, distanceToEma5, proximityLimit, nearEma5,
    ema5Rising, ema5Falling, ema20Rising, ema20Falling,
    bullishMomentum, bearishMomentum,
    wickTouchEma5: candle.low <= ema5[index] && candle.high >= ema5[index],
    candleBody: Math.abs(candle.close - candle.open),
    candleRange: candle.high - candle.low
  };

  if (bullishFlow) {
    return decision("CALL", "UPTREND",
      "EMA 5/20 Relaxed Trend Flow: ราคาอยู่เหนือ EMA 20 ใกล้ EMA 5 พร้อมเส้นเฉลี่ยลาดขึ้นและโมเมนตัมขาขึ้น",
      ["Close > EMA 20 (โซน CALL)", "ราคาอยู่ในระยะใกล้ EMA 5 ตาม ATR (ไม่จำเป็นต้องสัมผัส)", "EMA 5 และ EMA 20 มีความชันขึ้น", "แท่งล่าสุดยืนยันแรงส่งขึ้น"],
      metrics, 70);
  }
  if (bearishFlow) {
    return decision("PUT", "DOWNTREND",
      "EMA 5/20 Relaxed Trend Flow: ราคาอยู่ใต้ EMA 20 ใกล้ EMA 5 พร้อมเส้นเฉลี่ยลาดลงและโมเมนตัมขาลง",
      ["Close < EMA 20 (โซน PUT)", "ราคาอยู่ในระยะใกล้ EMA 5 ตาม ATR (ไม่จำเป็นต้องสัมผัส)", "EMA 5 และ EMA 20 มีความชันลง", "แท่งล่าสุดยืนยันแรงกดลง"],
      metrics, 70);
  }

  let reason = "เทรนด์ยังไม่ครบเงื่อนไข Proximity & Trend Flow";
  if (!bullishZone && !bearishZone) reason = "ราคาอยู่ใกล้ EMA 20 — ยังไม่เลือกทิศทาง";
  else if (!nearEma5) reason = "ราคาอยู่ห่าง EMA 5 เกินระยะ Proximity ที่กำหนดตาม ATR";
  else if (bullishZone && (!ema5Rising || !ema20Rising || !bullishMomentum)) reason = "อยู่โซน CALL แต่ความชันหรือโมเมนตัมขาขึ้นยังไม่ยืนยัน";
  else if (bearishZone && (!ema5Falling || !ema20Falling || !bearishMomentum)) reason = "อยู่โซน PUT แต่ความชันหรือโมเมนตัมขาลงยังไม่ยืนยัน";
  return {
    signal: "STANDBY", regime: bullishZone ? "UPTREND" : bearishZone ? "DOWNTREND" : "UNCLEAR",
    confidence: 0, score: 0, reason,
    evidence: [
      `EMA 5: ${ema5[index]}`, `EMA 20: ${ema20[index]}`,
      `ระยะจาก EMA 5: ${distanceToEma5} (เกณฑ์ใกล้: ${proximityLimit})`,
      `EMA5 slope: ${ema5Rising ? "UP" : ema5Falling ? "DOWN" : "FLAT"}; EMA20 slope: ${ema20Rising ? "UP" : ema20Falling ? "DOWN" : "FLAT"}`
    ],
    riskFlags: [], summary: reason, strategy: "EMA_5_20_RELAXED_TREND_FLOW",
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
    signalReleaseStatus: "EMA_5_20_RELAXED_TREND_FLOW_MANUAL_ONLY_NOT_OOS_VALIDATED"
  };
}

export { sourceGate };
