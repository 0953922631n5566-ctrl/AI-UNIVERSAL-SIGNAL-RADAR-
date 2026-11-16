const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * BB Pure Scalper confirmation for closed M1 candles.
 * Standard Bollinger Bands: SMA(20) +/- 2 population standard deviations.
 * A reversal requires an outer-band touch, a close back inside, a rejection wick,
 * and directional candle confirmation. A touch or close outside alone is not a signal.
 */
export function analyzeBBPureScalper(candles, options = {}) {
  const period = Number.isInteger(options.period) ? options.period : 20;
  const deviation = Number.isFinite(options.deviation) ? options.deviation : 2;
  if (!Array.isArray(candles) || candles.length < period + 1 ||
      !candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return { ready: false, signal: null, score: 0, status: "NOT_READY",
      reason: "BB Pure Scalper ต้องมีข้อมูล OHLC อย่างน้อย 21 แท่งปิด" };
  }
  const sample = candles.slice(-period);
  const closes = sample.map(c => c.close);
  const middle = mean(closes);
  const variance = mean(closes.map(value => (value - middle) ** 2));
  const standardDeviation = Math.sqrt(variance);
  const upper = middle + deviation * standardDeviation;
  const lower = middle - deviation * standardDeviation;
  const candle = candles.at(-1);
  const previous = candles.at(-2);
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const upperWickRatio = (candle.high - Math.max(candle.open, candle.close)) / range;
  const lowerWickRatio = (Math.min(candle.open, candle.close) - candle.low) / range;
  const upperTouch = candle.high >= upper;
  const lowerTouch = candle.low <= lower;
  const upperReclaimed = upperTouch && candle.close < upper;
  const lowerReclaimed = lowerTouch && candle.close > lower;
  const bearishConfirmation = candle.close < candle.open || candle.close < previous.close;
  const bullishConfirmation = candle.close > candle.open || candle.close > previous.close;
  const putValid = upperReclaimed && upperWickRatio >= 0.35 && bearishConfirmation;
  const callValid = lowerReclaimed && lowerWickRatio >= 0.35 && bullishConfirmation;
  const bandwidthPercent = middle !== 0 ? ((upper - lower) / Math.abs(middle)) * 100 : 0;
  const upperReclaim = upperReclaimed ? clamp((upper - candle.close) / Math.max(standardDeviation, Number.EPSILON)) : 0;
  const lowerReclaim = lowerReclaimed ? clamp((candle.close - lower) / Math.max(standardDeviation, Number.EPSILON)) : 0;
  const putScore = putValid
    ? Math.round(100 * (0.45 * clamp((upperWickRatio - 0.25) / 0.55) + 0.30 * upperReclaim + 0.25))
    : 0;
  const callScore = callValid
    ? Math.round(100 * (0.45 * clamp((lowerWickRatio - 0.25) / 0.55) + 0.30 * lowerReclaim + 0.25))
    : 0;
  const signal = callValid && !putValid ? "CALL" : putValid && !callValid ? "PUT" : null;
  const score = signal === "CALL" ? callScore : signal === "PUT" ? putScore : 0;
  const status = signal ? "REJECTION_CONFIRMED"
    : upperTouch || lowerTouch ? "TOUCH_WITHOUT_CONFIRMATION" : "NO_BAND_TOUCH";
  const reason = signal === "CALL"
    ? "BB LOWER REJECTION: แตะ/แทงทะลุขอบล่างแล้วปิดกลับเข้ากรอบ พร้อมแรงซื้อยืนยัน"
    : signal === "PUT"
      ? "BB UPPER REJECTION: แตะ/แทงทะลุขอบบนแล้วปิดกลับเข้ากรอบ พร้อมแรงขายยืนยัน"
      : status === "TOUCH_WITHOUT_CONFIRMATION"
        ? "ราคาแตะขอบ BB แต่ยังไม่มีแท่งปฏิเสธราคาที่ยืนยัน — ไม่ออกเสียงโหวต"
        : "ยังไม่พบการแตะขอบ Bollinger Bands";
  return {
    ready: true, signal, score, callScore, putScore, status, reason,
    parameters: { period, deviation },
    bands: { middle, upper, lower, standardDeviation, bandwidthPercent },
    candle: { upperTouch, lowerTouch, upperReclaimed, lowerReclaimed,
      upperWickRatio, lowerWickRatio, bearishConfirmation, bullishConfirmation }
  };
}
