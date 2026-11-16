const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * Independent BB Pure Scalper for closed M1 candles.
 * Standard BB(20,2). A band touch is the primary setup; one soft reversal cue
 * is enough to emit an independent candidate. No V1 score, trend, or vote is used.
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
  const upperWickRatio = clamp((candle.high - Math.max(candle.open, candle.close)) / range);
  const lowerWickRatio = clamp((Math.min(candle.open, candle.close) - candle.low) / range);

  const upperTouch = candle.high >= upper;
  const lowerTouch = candle.low <= lower;
  const upperReclaimed = upperTouch && candle.close <= upper;
  const lowerReclaimed = lowerTouch && candle.close >= lower;
  const bearishMomentum = candle.close < candle.open || candle.close < previous.close;
  const bullishMomentum = candle.close > candle.open || candle.close > previous.close;

  // Relaxed entry: band touch + ANY one of reclaim, a modest rejection wick,
  // or a first directional momentum turn. A large 35% wick is no longer mandatory.
  const putCue = upperReclaimed || upperWickRatio >= 0.18 || bearishMomentum;
  const callCue = lowerReclaimed || lowerWickRatio >= 0.18 || bullishMomentum;
  const putValid = upperTouch && putCue;
  const callValid = lowerTouch && callCue;

  const putScore = putValid ? Math.round(
    45 + (upperReclaimed ? 25 : 0) +
    20 * clamp(upperWickRatio / 0.40) + (bearishMomentum ? 10 : 0)
  ) : 0;
  const callScore = callValid ? Math.round(
    45 + (lowerReclaimed ? 25 : 0) +
    20 * clamp(lowerWickRatio / 0.40) + (bullishMomentum ? 10 : 0)
  ) : 0;

  let signal = null;
  let status = "NO_BAND_TOUCH";
  if (callValid && !putValid) signal = "CALL";
  else if (putValid && !callValid) signal = "PUT";
  else if (callValid && putValid && Math.abs(callScore - putScore) >= 8) {
    signal = callScore > putScore ? "CALL" : "PUT";
  }
  if (signal) status = "EARLY_REVERSAL_CANDIDATE";
  else if (upperTouch || lowerTouch) status = callValid && putValid
    ? "BOTH_BANDS_AMBIGUOUS" : "TOUCH_WATCHING";

  const score = signal === "CALL" ? callScore : signal === "PUT" ? putScore : 0;
  const reason = signal === "CALL"
    ? "BB LOWER TOUCH: ราคาแตะ/แทงขอบล่างและมีสัญญาณกลับขึ้นอย่างน้อยหนึ่งข้อ"
    : signal === "PUT"
      ? "BB UPPER TOUCH: ราคาแตะ/แทงขอบบนและมีสัญญาณกลับลงอย่างน้อยหนึ่งข้อ"
      : status === "TOUCH_WATCHING"
        ? "ราคาแตะขอบ BB แล้ว · เฝ้าดูจังหวะกลับตัว ไม่บังคับรอไส้เทียนยาว"
        : status === "BOTH_BANDS_AMBIGUOUS"
          ? "แท่งผันผวนแตะทั้งสองขอบ · ทิศทางไม่ชัดเจน"
          : "ยังไม่พบการแตะขอบ Bollinger Bands";

  return {
    ready: true, signal, score, callScore, putScore, status, reason,
    strategy: "BB20_2_INDEPENDENT_EARLY_TOUCH_REVERSAL",
    parameters: { period, deviation, wickThreshold: 0.18, confirmationMode: "ONE_SOFT_CUE" },
    bands: { middle, upper, lower, standardDeviation,
      bandwidthPercent: middle !== 0 ? ((upper - lower) / Math.abs(middle)) * 100 : 0 },
    candle: { upperTouch, lowerTouch, upperReclaimed, lowerReclaimed,
      upperWickRatio, lowerWickRatio, bearishMomentum, bullishMomentum }
  };
}
