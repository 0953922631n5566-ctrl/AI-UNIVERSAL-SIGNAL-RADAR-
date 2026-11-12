import {
  MIN_CLOSED_CANDLES, CONTEXT_CANDLES, ENTRY_CANDLES,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS
} from "./config.js";
import { analyzeAdaptiveEmaPool } from "./adaptive-ema-pool.js";

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
    summary: reason, strategy: "EMA5_ONLY_TREND_FLOW", entryType: "EMA5_TREND_FLOW",
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/**
 * Closed-candle M1 EMA5-only Trend Flow:
 * - CALL: close above EMA5, EMA5 rising, and bullish candle/close momentum.
 * - PUT: close below EMA5, EMA5 falling, and bearish candle/close momentum.
 * - EMA20 is calculated for reference/diagnostics only and never gates direction.
 * - No EMA5 touch, ATR proximity, wick-size, or EMA20 alignment requirement.
 */
export function calculatePureTechnicalSignal(candles) {
  if (!Array.isArray(candles) || candles.length < 6) {
    return { signal: "STANDBY", reason: "ต้องมีแท่งปิดอย่างน้อย 6 แท่งเพื่อคำนวณ EMA 5", evidence: [] };
  }
  if (!candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return { signal: "STANDBY", reason: "ข้อมูล OHLC ไม่ถูกต้อง", evidence: [] };
  }

  const closes = candles.map(c => c.close);
  const ema5 = emaSeries(closes, 5);
  const ema20 = emaSeries(closes, 20); // informational only; not used in the decision
  const index = closes.length - 1;
  const previous = candles[index - 1];
  const candle = candles[index];
  const ema5Rising = ema5[index] > ema5[index - 1];
  const ema5Falling = ema5[index] < ema5[index - 1];
  const aboveEma5 = candle.close > ema5[index];
  const belowEma5 = candle.close < ema5[index];
  const bullishMomentum = candle.close > candle.open || candle.close > previous.close;
  const bearishMomentum = candle.close < candle.open || candle.close < previous.close;
  const bullishFlow = aboveEma5 && ema5Rising && bullishMomentum;
  const bearishFlow = belowEma5 && ema5Falling && bearishMomentum;
  const metrics = {
    ema5: ema5[index], ema20: ema20[index], emaFast: ema5[index],
    aboveEma5, belowEma5, ema5Rising, ema5Falling,
    bullishMomentum, bearishMomentum,
    ema20InformationalOnly: true,
    candleBody: Math.abs(candle.close - candle.open),
    candleRange: candle.high - candle.low
  };

  if (bullishFlow) {
    return decision("CALL", "UPTREND",
      "EMA5 Only Trend Flow: ราคาปิดอยู่เหนือ EMA5 พร้อม EMA5 ชี้ขึ้นและโมเมนตัมขาขึ้น",
      ["ราคาปิดแท่ง M1 อยู่เหนือ EMA5", "EMA5 มีความชันขึ้น", "แท่งล่าสุดหรือราคาปิดเทียบแท่งก่อนยืนยันโมเมนตัมขาขึ้น", "EMA20 เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช้กรองสัญญาณ"],
      metrics, 70);
  }
  if (bearishFlow) {
    return decision("PUT", "DOWNTREND",
      "EMA5 Only Trend Flow: ราคาปิดอยู่ใต้ EMA5 พร้อม EMA5 ชี้ลงและโมเมนตัมขาลง",
      ["ราคาปิดแท่ง M1 อยู่ใต้ EMA5", "EMA5 มีความชันลง", "แท่งล่าสุดหรือราคาปิดเทียบแท่งก่อนยืนยันโมเมนตัมขาลง", "EMA20 เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช้กรองสัญญาณ"],
      metrics, 70);
  }

  let reason = "ราคาอยู่เหนือ/ใต้ EMA5 แต่ความชัน EMA5 หรือโมเมนตัมยังไม่ยืนยัน";
  if (!aboveEma5 && !belowEma5) reason = "ราคาปิดอยู่ตรง EMA5 — ยังไม่เลือกทิศทาง";
  else if (aboveEma5 && (!ema5Rising || !bullishMomentum)) reason = "อยู่เหนือ EMA5 แต่ EMA5 slope หรือโมเมนตัมขาขึ้นยังไม่ยืนยัน";
  else if (belowEma5 && (!ema5Falling || !bearishMomentum)) reason = "อยู่ใต้ EMA5 แต่ EMA5 slope หรือโมเมนตัมขาลงยังไม่ยืนยัน";
  return {
    signal: "STANDBY", regime: aboveEma5 ? "UPTREND" : belowEma5 ? "DOWNTREND" : "UNCLEAR",
    confidence: 0, score: 0, reason,
    evidence: [
      `EMA 5: ${ema5[index]}`,
      `ตำแหน่งราคา: ${aboveEma5 ? "เหนือ EMA5" : belowEma5 ? "ใต้ EMA5" : "ทับ EMA5"}`,
      `EMA5 slope: ${ema5Rising ? "UP" : ema5Falling ? "DOWN" : "FLAT"}`,
      "EMA20 เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช้เป็นเงื่อนไข CALL/PUT"
    ],
    riskFlags: [], summary: reason, strategy: "EMA5_ONLY_TREND_FLOW",
    provider: "LOCAL_TECHNICAL", metrics
  };
}

/** Deterministic Partial Scoring is the Main Market decision authority. */
export async function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  const base = {
    lastCandleEpoch: gate.lastCandleEpoch, dataMode: gate.mode,
    ageSeconds: gate.ageSeconds, livePriceReady: gate.ready,
    closedCandleCount: gate.closed.length, requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES }
  };
  if (!gate.ready) {
    return { signal:"STANDBY", reason:gate.reason, regime:"UNCLEAR", score:0, confidence:0,
      strategy:"SOURCE_QUALITY_GUARD", provider:"SYSTEM_GUARD", evidence:[], riskFlags:[gate.reason], ...base };
  }
  const adaptive = analyzeAdaptiveEmaPool(gate.closed);
  const signal = adaptive.signal === "CALL" || adaptive.signal === "PUT" ? adaptive.signal : "STANDBY";
  const direction = signal === "STANDBY" ? null : signal;
  const reason = adaptive.reason || "Adaptive EMA ยังไม่พบเงื่อนไขที่ผ่านเกณฑ์";
  const evidence = [
    `Adaptive EMA ที่เลือก: ${adaptive.selectedPeriod ?? "—"}`,
    `คะแนน: ${adaptive.score ?? 0}/100`,
    `สภาวะตลาด: ${adaptive.regime ?? "UNCLEAR"}`,
    `ตรวจสอบ EMA ทั้งหมด: ${adaptive.candidateCount ?? 0} ช่วง`,
    ...(Array.isArray(adaptive.topCandidates) ? adaptive.topCandidates.slice(0, 3).map(item =>
      `EMA ${item.period}: ${item.direction ?? "NEUTRAL"} · ${item.score}/100`) : [])
  ];
  return {
    signal, direction,
    regime: adaptive.regime === "TRENDING"
      ? (direction === "PUT" ? "DOWNTREND" : direction === "CALL" ? "UPTREND" : "TRENDING")
      : adaptive.regime,
    confidence: adaptive.score ?? 0,
    score: adaptive.score ?? 0,
    reason, summary: reason, evidence,
    riskFlags: adaptive.riskFlags || [],
    strategy: "ADAPTIVE_EMA_POOL_32_DYNAMIC_HANDOFF",
    entryType: "ADAPTIVE_EMA_DYNAMIC_HANDOFF",
    provider: "LOCAL_ADAPTIVE_EMA",
    metrics: {
      selectedEmaPeriod: adaptive.selectedPeriod,
      selectedEma: adaptive.selectedEma,
      efficiencyRatio: adaptive.efficiencyRatio,
      alternationRatio: adaptive.alternationRatio,
      currentRangeAtrRatio: adaptive.currentRangeAtrRatio,
      candidateCount: adaptive.candidateCount,
      warmupCandles: adaptive.warmupCandles
    },
    adaptiveEma: adaptive,
    ...base,
    prepareSignal: null,
    analyzedAt:new Date(Number.isFinite(options.now)?options.now:Date.now()).toISOString(),
    signalReleaseValidated:false,
    signalValidationStatus:"ADAPTIVE_EMA_MANUAL_ONLY_NOT_OOS_VALIDATED",
    signalValidationNote:"Adaptive EMA Pool 32 horizons · dynamic candidate selection · data quality and T-10/T-5 timing guards remain active · ยังไม่มีผลทดสอบ out-of-sample · ใช้ทดสอบแบบ paper/manual เท่านั้น",
    signalReleaseStatus:"ADAPTIVE_EMA_POOL_32_MANUAL_ONLY_NOT_OOS_VALIDATED"
  };
}
export { sourceGate };
