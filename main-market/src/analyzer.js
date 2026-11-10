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

function averageTrueRange(candles, period = 14) {
  const start = Math.max(1, candles.length - period);
  const ranges = [];
  for (let i = start; i < candles.length; i++) {
    const c = candles[i], previousClose = candles[i - 1].close;
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - previousClose),
      Math.abs(c.low - previousClose)));
  }
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
}

function decision(signal, regime, reason, evidence, metrics, strategy, confidence = 70) {
  return {
    signal, regime, confidence, score: confidence, reason, evidence, riskFlags: [],
    summary: reason, strategy: `PURE_TECHNICAL_EMA_3_8_50_${strategy}`,
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/**
 * Closed-candle M1 engine:
 * - Trend continuation: EMA alignment + two completed candles in the same direction.
 * - Reversal: confirmed EMA 3/8 cross with EMA 50 price-side confirmation.
 * - ATR extension guard avoids chasing a move that is already stretched.
 * No external AI/API calls; no live/in-progress candle is used for direction.
 */
export function calculatePureTechnicalSignal(candles) {
  if (!Array.isArray(candles) || candles.length < 51) {
    return { signal: "STANDBY", reason: "ต้องมีแท่งปิดอย่างน้อย 51 แท่งเพื่อคำนวณ EMA 50", evidence: [] };
  }
  if (!candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return { signal: "STANDBY", reason: "ข้อมูล OHLC ไม่ถูกต้อง", evidence: [] };
  }

  const closes = candles.map(c => c.close);
  const fast = emaSeries(closes, 3);
  const slow = emaSeries(closes, 8);
  const trend = emaSeries(closes, 50);
  const index = closes.length - 1, previous = index - 1, prior = index - 2;
  const current = candles[index], previousCandle = candles[previous];
  const atr = averageTrueRange(candles, 14);
  const isUptrend = current.close > trend[index];
  const isDowntrend = current.close < trend[index];
  const bullishCross = fast[previous] <= slow[previous] && fast[index] > slow[index];
  const bearishCross = fast[previous] >= slow[previous] && fast[index] < slow[index];
  const bullishContinuation = fast[index] > slow[index] && slow[index] > trend[index] &&
    isUptrend && current.close > current.open && previousCandle.close > previousCandle.open &&
    current.close > previousCandle.close;
  const bearishContinuation = fast[index] < slow[index] && slow[index] < trend[index] &&
    isDowntrend && current.close < current.open && previousCandle.close < previousCandle.open &&
    current.close < previousCandle.close;
  const extension = atr > 0 ? Math.abs(current.close - fast[index]) / atr : Infinity;
  const notOverextended = extension <= 1.25;
  const bodyRatio = atr > 0 ? Math.abs(current.close - current.open) / atr : 0;
  const meaningfulBody = bodyRatio >= 0.10;
  const metrics = {
    emaFast: fast[index], emaSlow: slow[index], trendEma: trend[index],
    previousEmaFast: fast[previous], previousEmaSlow: slow[previous],
    atr14: atr, emaFastDistanceAtr: Number.isFinite(extension) ? extension : null,
    lastBodyAtr: bodyRatio
  };

  // Continuation is evaluated first so a mature trend does not wait for a fresh crossover.
  if (bullishContinuation && notOverextended && meaningfulBody) {
    return decision("CALL", "UPTREND",
      "Trend continuation: EMA 3 > EMA 8 > EMA 50 และแท่งปิดเขียวต่อเนื่อง 2 แท่ง โดยราคาไม่ยืดเกิน ATR",
      ["EMA 3 > EMA 8 > EMA 50", "สองแท่งปิดล่าสุดเป็นขาขึ้น", "Close ล่าสุดสูงกว่าก่อนหน้า", "ราคาไม่ห่าง EMA 3 เกิน 1.25 ATR"],
      metrics, "TREND_CONTINUATION", 68);
  }
  if (bearishContinuation && notOverextended && meaningfulBody) {
    return decision("PUT", "DOWNTREND",
      "Trend continuation: EMA 3 < EMA 8 < EMA 50 และแท่งปิดแดงต่อเนื่อง 2 แท่ง โดยราคาไม่ยืดเกิน ATR",
      ["EMA 3 < EMA 8 < EMA 50", "สองแท่งปิดล่าสุดเป็นขาลง", "Close ล่าสุดต่ำกว่าก่อนหน้า", "ราคาไม่ห่าง EMA 3 เกิน 1.25 ATR"],
      metrics, "TREND_CONTINUATION", 68);
  }

  if (bullishCross && isUptrend && current.close > current.open && notOverextended) {
    return decision("CALL", "REVERSAL_CONFIRMED",
      "EMA 3 ตัดขึ้นเหนือ EMA 8 พร้อมแท่งปิดเขียวและราคายืนยันเหนือ EMA 50",
      ["EMA 3 bullish crossover", "แท่งล่าสุดปิดเขียว", "Close > EMA 50", "ราคาไม่ยืดเกิน 1.25 ATR"],
      metrics, "REVERSAL_CONFIRMATION", 70);
  }
  if (bearishCross && isDowntrend && current.close < current.open && notOverextended) {
    return decision("PUT", "REVERSAL_CONFIRMED",
      "EMA 3 ตัดลงใต้ EMA 8 พร้อมแท่งปิดแดงและราคายืนยันใต้ EMA 50",
      ["EMA 3 bearish crossover", "แท่งล่าสุดปิดแดง", "Close < EMA 50", "ราคาไม่ยืดเกิน 1.25 ATR"],
      metrics, "REVERSAL_CONFIRMATION", 70);
  }

  let reason = "ยังไม่มี Trend Continuation หรือ Reversal ที่ยืนยันจากแท่งปิด";
  if ((bullishContinuation || bearishContinuation) && !notOverextended) {
    reason = "พบแนวโน้มต่อเนื่องแต่ราคาเคลื่อนห่าง EMA 3 เกิน 1.25 ATR — งดไล่ราคา";
  } else if ((bullishContinuation || bearishContinuation) && !meaningfulBody) {
    reason = "พบแนวโน้มแต่แท่งล่าสุดมีแรงส่งต่ำ — รอยืนยัน";
  } else if (bullishCross || bearishCross) {
    reason = "พบ EMA crossover แต่แท่งปิด/EMA 50/ระยะ ATR ยังไม่ยืนยันครบ";
  } else if (fast[index] > slow[index] && fast[index] < trend[index]) {
    reason = "EMA ระยะสั้นเริ่มฟื้นแต่ยังอยู่ใต้ EMA 50 — รอยืนยัน CALL";
  } else if (fast[index] < slow[index] && fast[index] > trend[index]) {
    reason = "EMA ระยะสั้นเริ่มอ่อนแต่ยังอยู่เหนือ EMA 50 — รอยืนยัน PUT";
  }
  return {
    signal: "STANDBY", regime: isUptrend ? "UPTREND" : isDowntrend ? "DOWNTREND" : "UNCLEAR",
    confidence: 0, score: 0, reason,
    evidence: [`EMA 3: ${fast[index]}`, `EMA 8: ${slow[index]}`, `EMA 50: ${trend[index]}`],
    riskFlags: [], summary: reason, strategy: "PURE_TECHNICAL_EMA_3_8_50",
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
    signalReleaseStatus: "PURE_TECHNICAL_MANUAL_ONLY_NOT_OOS_VALIDATED"
  };
}

export { sourceGate };
