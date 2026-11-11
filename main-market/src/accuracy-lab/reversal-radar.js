/**
 * ACCURACY LAB — REVERSAL RADAR (shadow-only).
 *
 * This module is intentionally NOT imported by the production analyzer.
 * It diagnoses possible M1 trend reversals without changing any ORIGINAL 84
 * CALL/PUT, PREPARE, timing, delivery, or Mini App behavior.
 */

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function ema(values, period = 5) {
  const alpha = 2 / (period + 1);
  let current = values[0];
  const result = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * alpha + current * (1 - alpha);
    result.push(current);
  }
  return result;
}

function atr(candles, period = 14) {
  const ranges = candles.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - candles[index].close),
    Math.abs(candle.low - candles[index].close)
  ));
  return mean(ranges.slice(-period));
}

function valid(candles) {
  return Array.isArray(candles) && candles.length >= 30 && candles.every(candle =>
    candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low
  );
}

function evaluateDirection(candles, trend, direction, ema5, volatility) {
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const before = candles.at(-3);
  const prior = candles.slice(-9, -1);
  const swingHigh = Math.max(...prior.map(candle => candle.high));
  const swingLow = Math.min(...prior.map(candle => candle.low));
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const body = Math.abs(last.close - last.open);

  const bullish = direction === "CALL";
  const opposingWick = bullish ? lowerWick : upperWick;
  const rejection = clamp((opposingWick / range - 0.20) / 0.55);
  const swept = bullish ? last.low < swingLow : last.high > swingHigh;
  const reclaimed = bullish ? last.close > swingLow : last.close < swingHigh;
  const fakeout = swept && reclaimed && opposingWick / range >= 0.30;

  const recentBodies = candles.slice(-4, -1).map(candle => Math.abs(candle.close - candle.open));
  const bodyFade = recentBodies.length
    ? clamp((mean(recentBodies) - body) / Math.max(volatility * 0.35, Number.EPSILON))
    : 0;
  const moveNow = last.close - previous.close;
  const moveBefore = previous.close - before.close;
  const momentumFade = bullish
    ? clamp((Math.max(0, -moveNow) + Math.max(0, moveBefore)) / Math.max(volatility * 0.65, Number.EPSILON))
    : clamp((Math.max(0, moveNow) + Math.max(0, -moveBefore)) / Math.max(volatility * 0.65, Number.EPSILON));

  const slopeNow = ema5.at(-1) - ema5.at(-2);
  const slopeBefore = ema5.at(-2) - ema5.at(-3);
  const slopeTurn = bullish
    ? slopeNow > 0 && slopeBefore <= 0
    : slopeNow < 0 && slopeBefore >= 0;
  const priceReclaimedEma = bullish
    ? last.close > ema5.at(-1)
    : last.close < ema5.at(-1);
  const structureBreak = bullish ? last.close > swingHigh : last.close < swingLow;
  const closeConfirms = bullish
    ? last.close > last.open || last.close > previous.close
    : last.close < last.open || last.close < previous.close;

  const components = {
    exhaustion: Math.round(20 * (0.55 * bodyFade + 0.45 * momentumFade) * 10) / 10,
    rejection: Math.round(25 * Math.max(rejection, fakeout ? 1 : 0) * 10) / 10,
    ema5Turn: Math.round(25 * ((slopeTurn ? 0.65 : 0) + (priceReclaimedEma ? 0.35 : 0)) * 10) / 10,
    structureBreak: Math.round(30 * (structureBreak ? 1 : 0) * 10) / 10
  };
  const score = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0) * 10) / 10;
  const confirmed = score >= 65 && closeConfirms && (structureBreak || (slopeTurn && (fakeout || rejection >= 0.65)));
  const warning = score >= 35;

  return {
    direction, score, components,
    stage: confirmed ? "REVERSAL_CONFIRMED" : warning ? "REVERSAL_WARNING" : "NO_REVERSAL",
    pattern: fakeout ? (bullish ? "BEAR_TRAP" : "BULL_TRAP")
      : structureBreak ? (bullish ? "SWING_BREAK_UP" : "SWING_BREAK_DOWN")
      : slopeTurn ? (bullish ? "EMA5_TURN_UP" : "EMA5_TURN_DOWN") : null,
    details: {
      priorTrend: trend, swingHigh, swingLow, atr14: volatility,
      opposingWickRatio: opposingWick / range, bodyFade, momentumFade,
      slopeTurn, priceReclaimedEma, structureBreak, closeConfirms
    }
  };
}

/**
 * Closed M1 candles only, oldest first. Returns a diagnostic candidate;
 * it never overrides the caller's baseline signal.
 */
export function detectReversalRadar(candles) {
  if (!valid(candles)) {
    return {
      ready: false, priorTrend: "UNCLEAR", stage: "INSUFFICIENT_DATA",
      candidateDirection: null, score: 0, reason: "ต้องมีแท่ง M1 ที่ปิดแล้วและ OHLC ถูกต้องอย่างน้อย 30 แท่ง"
    };
  }

  const closes = candles.map(candle => candle.close);
  const ema5 = ema(closes, 5);
  const volatility = atr(candles);
  if (!(volatility > 0)) {
    return {
      ready: false, priorTrend: "UNCLEAR", stage: "INSUFFICIENT_DATA",
      candidateDirection: null, score: 0, reason: "ATR เป็นศูนย์หรือข้อมูลราคาไม่มีความผันผวน"
    };
  }

  const slope = ema5.at(-1) - ema5.at(-6);
  const priorTrend = slope > volatility * 0.10 ? "UPTREND"
    : slope < -volatility * 0.10 ? "DOWNTREND" : "UNCLEAR";
  if (priorTrend === "UNCLEAR") {
    return {
      ready: true, priorTrend, stage: "NO_REVERSAL",
      candidateDirection: null, score: 0,
      reason: "แนวโน้มก่อนหน้าไม่ชัดเจน จึงไม่จัดประเภทเป็นการกลับตัว"
    };
  }

  const candidateDirection = priorTrend === "UPTREND" ? "PUT" : "CALL";
  const result = evaluateDirection(candles, priorTrend, candidateDirection, ema5, volatility);
  return {
    ready: true, priorTrend, candidateDirection,
    stage: result.stage, score: result.score,
    components: result.components, pattern: result.pattern,
    details: result.details,
    reason: result.stage === "REVERSAL_CONFIRMED"
      ? `พบหลักฐานกลับตัว ${candidateDirection} จากแนวโน้มเดิม ${priorTrend}`
      : result.stage === "REVERSAL_WARNING"
        ? `พบสัญญาณเตือนการหมดแรงของ ${priorTrend} แต่ยังไม่ยืนยันการกลับตัว`
        : `ยังไม่พบหลักฐานกลับตัวที่เพียงพอจาก ${priorTrend}`,
    shadowOnly: true,
    baselineSignalChanged: false
  };
}
