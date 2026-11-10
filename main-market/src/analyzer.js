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

/**
 * Pure local EMA 3/8 crossover with EMA 50 trend filter.
 * Only closed candles are passed to this function. No external AI/API calls.
 */
export function calculatePureTechnicalSignal(candles) {
  if (!Array.isArray(candles) || candles.length < 51) {
    return { signal: "STANDBY", reason: "ต้องมีแท่งปิดอย่างน้อย 51 แท่งเพื่อคำนวณ EMA 50", evidence: [] };
  }

  const closes = candles.map(c => c.close);
  if (!closes.every(Number.isFinite)) {
    return { signal: "STANDBY", reason: "ข้อมูลราคาปิดไม่ถูกต้อง", evidence: [] };
  }

  const fast = emaSeries(closes, 3);
  const slow = emaSeries(closes, 8);
  const trend = emaSeries(closes, 50);
  const index = closes.length - 1;
  const previous = index - 1;
  const currentCandle = candles[index];
  const isUptrend = currentCandle.close > trend[index];
  const isDowntrend = currentCandle.close < trend[index];
  const bullishCross = fast[previous] <= slow[previous] && fast[index] > slow[index];
  const bearishCross = fast[previous] >= slow[previous] && fast[index] < slow[index];

  if (bullishCross && isUptrend) {
    return {
      signal: "CALL", regime: "UPTREND", confidence: 70, score: 70,
      reason: "EMA 3 ตัดขึ้นเหนือ EMA 8 และราคาอยู่เหนือ EMA 50",
      evidence: ["EMA 3 bullish crossover", "Close > EMA 50"],
      riskFlags: [], summary: "สัญญาณ CALL จาก EMA crossover พร้อมตัวกรองเทรนด์",
      strategy: "PURE_TECHNICAL_EMA_3_8_50", provider: "LOCAL_TECHNICAL",
      metrics: { emaFast: fast[index], emaSlow: slow[index], trendEma: trend[index],
        previousEmaFast: fast[previous], previousEmaSlow: slow[previous] }
    };
  }
  if (bearishCross && isDowntrend) {
    return {
      signal: "PUT", regime: "DOWNTREND", confidence: 70, score: 70,
      reason: "EMA 3 ตัดลงใต้ EMA 8 และราคาอยู่ใต้ EMA 50",
      evidence: ["EMA 3 bearish crossover", "Close < EMA 50"],
      riskFlags: [], summary: "สัญญาณ PUT จาก EMA crossover พร้อมตัวกรองเทรนด์",
      strategy: "PURE_TECHNICAL_EMA_3_8_50", provider: "LOCAL_TECHNICAL",
      metrics: { emaFast: fast[index], emaSlow: slow[index], trendEma: trend[index],
        previousEmaFast: fast[previous], previousEmaSlow: slow[previous] }
    };
  }

  const reason = bullishCross ? "EMA ตัดขึ้นแต่ราคายังไม่ยืนยันเหนือ EMA 50"
    : bearishCross ? "EMA ตัดลงแต่ราคายังไม่ยืนยันใต้ EMA 50"
    : "ยังไม่มี EMA 3/8 crossover ที่ยืนยันด้วย EMA 50";
  return {
    signal: "STANDBY", regime: isUptrend ? "UPTREND" : isDowntrend ? "DOWNTREND" : "UNCLEAR",
    confidence: 0, score: 0, reason, evidence: [
      `EMA 3: ${fast[index]}`, `EMA 8: ${slow[index]}`, `EMA 50: ${trend[index]}`
    ], riskFlags: [], summary: reason,
    strategy: "PURE_TECHNICAL_EMA_3_8_50", provider: "LOCAL_TECHNICAL",
    metrics: { emaFast: fast[index], emaSlow: slow[index], trendEma: trend[index],
      previousEmaFast: fast[previous], previousEmaSlow: slow[previous] }
  };
}

/** Data quality/timing guards are unchanged; direction is decided locally. */
export async function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  const base = {
    lastCandleEpoch: gate.lastCandleEpoch,
    dataMode: gate.mode,
    ageSeconds: gate.ageSeconds,
    livePriceReady: gate.ready,
    closedCandleCount: gate.closed.length,
    requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES }
  };
  if (!gate.ready) {
    return {
      signal: "STANDBY", reason: gate.reason, regime: "UNCLEAR", score: 0,
      confidence: 0, strategy: "SOURCE_QUALITY_GUARD", provider: "SYSTEM_GUARD",
      evidence: [], riskFlags: [gate.reason], ...base
    };
  }

  const decision = calculatePureTechnicalSignal(gate.closed.slice(-MIN_CLOSED_CANDLES));
  return {
    ...decision, ...base,
    evidence: Array.isArray(decision.evidence) ? decision.evidence : [],
    analyzedAt: new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(),
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: MIN_CLOSED_CANDLES },
    signalReleaseStatus: "PURE_TECHNICAL_MANUAL_ONLY_NOT_OOS_VALIDATED"
  };
}

export { sourceGate };
