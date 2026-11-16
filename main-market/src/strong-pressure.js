const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/**
 * Measures strong directional price pressure from CLOSED OHLC candles.
 * This is a price-action proxy, not exchange order-flow or traded volume.
 */
export function assessDirectionalPressure(candles, direction, { ema5, ema5Slope, structureDirection = null, atr } = {}) {
  if (!Array.isArray(candles) || candles.length < 2 ||
      !["CALL", "PUT"].includes(direction) ||
      !Number.isFinite(ema5) || !Number.isFinite(ema5Slope) ||
      !Number.isFinite(atr) || atr <= 0) {
    return { ready: false, strong: false, score: 0, reason: "ข้อมูลแรงซื้อ/ขายไม่เพียงพอ" };
  }

  const candle = candles.at(-1);
  if (!candle || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
    return { ready: false, strong: false, score: 0, reason: "แท่งราคาล่าสุดไม่สมบูรณ์" };
  }

  const range = candle.high - candle.low;
  if (!(range > 0)) return { ready: false, strong: false, score: 0, reason: "ช่วงราคาแท่งล่าสุดเป็นศูนย์" };

  const sign = direction === "CALL" ? 1 : -1;
  const body = sign * (candle.close - candle.open);
  const bodyRatio = clamp(Math.abs(candle.close - candle.open) / range);
  const closeLocation = clamp((candle.close - candle.low) / range);
  const directionalCloseLocation = direction === "CALL" ? closeLocation : 1 - closeLocation;
  const bodyAtr = Math.max(0, body) / atr;
  const pressureScore = clamp(
    0.40 * bodyRatio +
    0.35 * directionalCloseLocation +
    0.25 * clamp(bodyAtr / 0.80)
  );

  const alignedEma = direction === "CALL"
    ? candle.close > ema5 && ema5Slope > 0
    : candle.close < ema5 && ema5Slope < 0;
  const alignedStructure = structureDirection === direction;
  const strong = body > 0 && bodyRatio >= 0.62 &&
    directionalCloseLocation >= 0.78 && bodyAtr >= 0.55 &&
    pressureScore >= 0.74 && (alignedEma || alignedStructure);

  return {
    ready: true,
    strong,
    score: Number(pressureScore.toFixed(3)),
    bodyRatio: Number(bodyRatio.toFixed(3)),
    directionalCloseLocation: Number(directionalCloseLocation.toFixed(3)),
    bodyAtr: Number(bodyAtr.toFixed(3)),
    alignedEma,
    alignedStructure,
    type: strong ? (direction === "CALL" ? "STRONG_BUYING_PRESSURE" : "STRONG_SELLING_PRESSURE") : "NORMAL",
    reason: strong
      ? (direction === "CALL"
          ? "แรงซื้อเด่น: แท่งเขียวมีลำตัวแข็งแรง ปิดใกล้จุดสูง และ EMA/โครงสร้างหนุน"
          : "แรงขายเด่น: แท่งแดงมีลำตัวแข็งแรง ปิดใกล้จุดต่ำ และ EMA/โครงสร้างหนุน")
      : "แรงซื้อ/ขายยังไม่ผ่านเกณฑ์ความแข็งแกร่งสำหรับเข้าเร็ว"
  };
}

/**
 * A conditional fast lane, not a blanket lower score threshold.
 * Strong price pressure may release from 58 only when direction is decisive,
 * market is not choppy/abnormally volatile, and the late-entry guard is clear.
 */
export function qualifiesForStrongPressureEarlyEntry({
  pressure, score, gap, choppy = false, atrSpike = false, waitForPullback = false
} = {}) {
  return Boolean(pressure?.strong && Number.isFinite(score) && score >= 58 &&
    Number.isFinite(gap) && gap >= 8 && !choppy && !atrSpike && !waitForPullback);
}
