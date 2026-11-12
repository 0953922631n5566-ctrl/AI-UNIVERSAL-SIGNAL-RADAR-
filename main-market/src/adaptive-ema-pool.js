const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const PERIODS = Object.freeze(Array.from({ length: 32 }, (_, index) => index + 2));
const MIN_WARMUP_CANDLES = 100; // 3x the longest EMA period (33), rounded up.

function validCandles(candles) {
  return Array.isArray(candles) && candles.length >= MIN_WARMUP_CANDLES && candles.every(c =>
    c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.close > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= c.low
  );
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  let current = values[0];
  const output = [current];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageTrueRange(candles, period = 14) {
  const recent = candles.slice(-(period + 1));
  const ranges = recent.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - recent[index].close),
    Math.abs(candle.low - recent[index].close)
  ));
  return mean(ranges);
}

function classifyRegime(candles, atr) {
  const recent = candles.slice(-9);
  const closes = recent.map(candle => candle.close);
  const path = closes.slice(1).reduce((sum, close, index) => sum + Math.abs(close - closes[index]), 0);
  const efficiency = path > 0 ? Math.abs(closes.at(-1) - closes[0]) / path : 0;
  const directions = closes.slice(1).map((close, index) => Math.sign(close - closes[index])).filter(Boolean);
  const flips = directions.slice(1).reduce((sum, direction, index) =>
    sum + (direction !== directions[index] ? 1 : 0), 0);
  const alternation = directions.length > 1 ? flips / (directions.length - 1) : 0;
  const last = candles.at(-1);
  const rangeRatio = atr > 0 ? (last.high - last.low) / atr : 0;

  if (rangeRatio >= 2.8) return { regime: "HIGH_VOLATILITY", efficiency, alternation, rangeRatio };
  if (efficiency <= 0.20 && alternation >= 0.55) return { regime: "SIDEWAY", efficiency, alternation, rangeRatio };
  if (efficiency >= 0.48 && alternation <= 0.55) return { regime: "TRENDING", efficiency, alternation, rangeRatio };
  return { regime: "TRANSITION", efficiency, alternation, rangeRatio };
}

function evaluateCandidate(candles, period, atr, regime) {
  const closes = candles.map(candle => candle.close);
  const ema = emaSeries(closes, period);
  const index = closes.length - 1;
  const candle = candles[index];
  const slopeNow = ema[index] - ema[index - 1];
  const slopePrevious = ema[index - 1] - ema[index - 2];
  const slopeEarlier = ema[index - 2] - ema[index - 3];
  const direction = slopeNow > 0 ? "CALL" : slopeNow < 0 ? "PUT" : null;
  const sideAligned = direction === "CALL" ? candle.close > ema[index]
    : direction === "PUT" ? candle.close < ema[index] : false;
  const momentum = candle.close - candles[Math.max(0, index - 3)].close;
  const momentumAligned = direction === "CALL" ? momentum > 0
    : direction === "PUT" ? momentum < 0 : false;
  const slopeAligned = direction === "CALL"
    ? slopePrevious > 0 && slopeEarlier > 0
    : direction === "PUT" ? slopePrevious < 0 && slopeEarlier < 0 : false;
  const normalizedSlope = atr > 0 ? Math.abs(slopeNow) / atr : 0;
  const proximity = atr > 0 ? clamp(1 - Math.abs(candle.close - ema[index]) / (atr * 2.5)) : 0;

  let score = (direction ? 20 : 0) +
    (sideAligned ? 25 : 0) +
    (momentumAligned ? 20 : 0) +
    (slopeAligned ? 20 : 0) +
    (proximity * 10) +
    (clamp(normalizedSlope / 0.20) * 5);

  // Shorter horizons react faster in transitions; longer horizons are more stable in trends.
  if (regime === "TRENDING") score += period >= 5 && period <= 40 ? 5 : -Math.min(5, Math.abs(period - 22) / 16);
  if (regime === "TRANSITION") score += period >= 2 && period <= 20 ? 5 : -Math.min(5, (period - 20) / 16);
  if (regime === "SIDEWAY" || regime === "HIGH_VOLATILITY") score = Math.min(score, 55);

  return {
    period,
    ema: ema[index],
    direction,
    score: Math.round(clamp(score, 0, 100) * 10) / 10,
    slope: slopeNow,
    sideAligned,
    momentumAligned,
    slopeAligned
  };
}

/**
 * Active adaptive EMA candidate pool.
 * Evaluates 32 well-warmed EMA horizons (2..101) against closed M1 candles,
 * then selects the best fit for the current candle regime. The selected candidate
 * is the sole directional analyzer; source and timing guards remain external.
 */
export function analyzeAdaptiveEmaPool(candles) {
  if (!validCandles(candles)) {
    return {
      ready: false, mode: "ADAPTIVE_EMA_ACTIVE", signal: "STANDBY", direction: null,
      selectedPeriod: null, selectedEma: null, score: 0, regime: "INSUFFICIENT_DATA",
      candidateCount: PERIODS.length, reason: `ต้องมีแท่ง M1 ปิดอย่างน้อย ${MIN_WARMUP_CANDLES} แท่ง เพื่อ warm up EMA 101 อย่างเหมาะสม`,
      riskFlags: ["INSUFFICIENT_OR_INVALID_CANDLES"], topCandidates: []
    };
  }

  const atr = averageTrueRange(candles);
  const context = classifyRegime(candles, atr);
  const candidates = PERIODS.map(period => evaluateCandidate(candles, period, atr, context.regime))
    .sort((left, right) => right.score - left.score || left.period - right.period);
  const selected = candidates[0];
  const releaseAllowed = context.regime !== "SIDEWAY" &&
    context.regime !== "HIGH_VOLATILITY" &&
    selected.score >= 68 &&
    selected.direction &&
    selected.sideAligned &&
    selected.momentumAligned;
  const signal = releaseAllowed ? selected.direction : "STANDBY";
  const reason = context.regime === "SIDEWAY"
    ? "ตลาด Sideway: เก็บผลวิเคราะห์ EMA แต่ไม่ปล่อยทิศทาง"
    : context.regime === "HIGH_VOLATILITY"
      ? "แท่งเทียนผันผวนเกินขอบเขต: ระงับสัญญาณ Adaptive EMA"
      : releaseAllowed
        ? `Adaptive EMA ${selected.period} ผ่านเกณฑ์คะแนน ${selected.score}/100`
        : `EMA ที่เหมาะสมที่สุดคือ ${selected.period} แต่หลักฐานยังไม่ผ่านเกณฑ์ 68/100`;

  return {
    ready: true,
    mode: "ADAPTIVE_EMA_ACTIVE",
    signal,
    direction: selected.direction,
    selectedPeriod: selected.period,
    selectedEma: Number(selected.ema.toFixed(6)),
    score: selected.score,
    regime: context.regime,
    efficiencyRatio: Number(context.efficiency.toFixed(3)),
    alternationRatio: Number(context.alternation.toFixed(3)),
    currentRangeAtrRatio: Number(context.rangeRatio.toFixed(3)),
    candidateCount: PERIODS.length,
    warmupCandles: MIN_WARMUP_CANDLES,
    reason,
    riskFlags: releaseAllowed ? [] : [context.regime, "ADAPTIVE_EMA_SIGNAL_NOT_RELEASED"],
    topCandidates: candidates.slice(0, 5).map(({ period, direction, score }) => ({ period, direction, score }))
  };
}

export const ADAPTIVE_EMA_PERIODS = PERIODS;
