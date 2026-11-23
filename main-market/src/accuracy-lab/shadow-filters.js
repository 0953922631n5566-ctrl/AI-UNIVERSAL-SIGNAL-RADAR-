/**
 * ACCURACY LAB — shadow-only signal quality diagnostics.
 *
 * This module MUST NOT be imported by the production analyzer or signal
 * dispatcher. It annotates an ORIGINAL 84 decision for offline/replay study;
 * it never changes CALL/PUT, PREPARE, timing, delivery, or UI behavior.
 */
const DEFAULTS = Object.freeze({
  minCandles: 20,
  atrPeriod: 14,
  efficiencyPeriod: 10,
  maxExtensionAtr: 0.9,
  minBodyRatio: 0.25,
  maxOpposingWickRatio: 0.55,
  minDirectionalEfficiency: 0.2
});

const mean = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

function ema(values, period) {
  const k = 2 / (period + 1);
  let current = values[0];
  const result = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
    result.push(current);
  }
  return result;
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

function validCandles(candles) {
  return Array.isArray(candles) && candles.every(c =>
    c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= c.low
  );
}

/**
 * @param {Array<{open:number,high:number,low:number,close:number}>} candles
 *   Closed M1 candles available at the decision timestamp, oldest first.
 * @param {"CALL"|"PUT"} baselineSignal ORIGINAL 84 direction.
 * @param {object} overrides Optional research-only threshold overrides.
 * @returns A diagnostic record. candidateWouldReject is NOT an order decision.
 */
export function evaluateShadowFilters(candles, baselineSignal, overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  if (baselineSignal !== "CALL" && baselineSignal !== "PUT") {
    return { ready: false, baselineSignal, candidateWouldReject: false,
      flags: [], reason: "A baseline CALL or PUT is required", metrics: null };
  }
  if (!validCandles(candles) || candles.length < config.minCandles) {
    return { ready: false, baselineSignal, candidateWouldReject: false,
      flags: [], reason: "Insufficient or invalid closed-candle history", metrics: null };
  }

  const closes = candles.map(c => c.close);
  const ema5 = ema(closes, 5);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const ranges = candles.slice(1).map((c, i) => trueRange(c, candles[i].close));
  const atrValues = ranges.slice(-config.atrPeriod);
  const atr = mean(atrValues);
  const candleRange = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const isCall = baselineSignal === "CALL";
  const extensionAtr = atr > 0
    ? (isCall ? last.close - ema5.at(-1) : ema5.at(-1) - last.close) / atr
    : null;
  const bodyRatio = candleRange > 0 ? body / candleRange : 0;
  const opposingWickRatio = candleRange > 0
    ? (isCall ? upperWick : lowerWick) / candleRange
    : 0;

  const periodCloses = closes.slice(-(config.efficiencyPeriod + 1));
  const pathLength = periodCloses.slice(1).reduce(
    (sum, value, i) => sum + Math.abs(value - periodCloses[i]), 0);
  const netMove = Math.abs(periodCloses.at(-1) - periodCloses[0]);
  const directionalEfficiency = pathLength > 0 ? netMove / pathLength : 0;
  const lastMove = last.close - previous.close;
  const directionConsistent = isCall ? lastMove > 0 : lastMove < 0;

  const metrics = {
    atr,
    ema5: ema5.at(-1),
    extensionAtr,
    bodyRatio,
    opposingWickRatio,
    directionalEfficiency,
    directionConsistent
  };
  const flags = [];
  if (extensionAtr !== null && extensionAtr > config.maxExtensionAtr)
    flags.push("LATE_ENTRY_OVEREXTENDED");
  if (bodyRatio < config.minBodyRatio)
    flags.push("WEAK_CANDLE_BODY");
  if (opposingWickRatio > config.maxOpposingWickRatio)
    flags.push("STRONG_OPPOSING_WICK");
  if (directionalEfficiency < config.minDirectionalEfficiency)
    flags.push("LOW_DIRECTIONAL_EFFICIENCY");
  if (!directionConsistent)
    flags.push("LATEST_CLOSE_NOT_CONFIRMING_DIRECTION");

  return {
    ready: true,
    baselineSignal,
    candidateWouldReject: flags.length > 0,
    flags,
    reason: flags.length
      ? "Shadow-only candidate filter flags; ORIGINAL 84 signal remains unchanged"
      : "No shadow filter flags; ORIGINAL 84 signal remains unchanged",
    metrics,
    config
  };
}

export { DEFAULTS as SHADOW_FILTER_DEFAULTS };
