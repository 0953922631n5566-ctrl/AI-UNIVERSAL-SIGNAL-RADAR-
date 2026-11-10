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

function rsiSeries(values, period = 14) {
  if (values.length <= period) return [];
  const output = Array(period).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  const value = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + avgGain / avgLoss);
  output.push(value());
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    output.push(value());
  }
  return output;
}

function extremes(values) {
  return {
    high: Math.max(...values),
    low: Math.min(...values)
  };
}

/**
 * Dual-stage reversal state layered over the EMA5-only M1 trend.
 * Warning is intentionally non-directional; confirmation requires a close
 * beyond a prior, completed micro swing level.
 */
export function detectMultiStageReversal(candles) {
  if (!Array.isArray(candles) || candles.length < 30 ||
      !candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return {
      stage: "UNCLEAR", trend: "UNCLEAR", warning: null, confirmedDirection: null,
      reason: "ต้องมีข้อมูล OHLC ที่ถูกต้องอย่างน้อย 30 แท่ง M1"
    };
  }

  const closes = candles.map(c => c.close);
  const ema5 = emaSeries(closes, 5);
  const rsi = rsiSeries(closes, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const previous = candles[lastIndex - 1];
  const prior = candles.slice(-7, -1);
  const swingHigh = Math.max(...prior.map(c => c.high));
  const swingLow = Math.min(...prior.map(c => c.low));
  const trend = last.close > ema5[lastIndex] && ema5[lastIndex] > ema5[lastIndex - 1]
    ? "UPTREND"
    : last.close < ema5[lastIndex] && ema5[lastIndex] < ema5[lastIndex - 1]
      ? "DOWNTREND" : "UNCLEAR";

  const bearishBreak = trend !== "DOWNTREND" && last.close < swingLow;
  const bullishBreak = trend !== "UPTREND" && last.close > swingHigh;
  if (bearishBreak || bullishBreak) {
    return {
      stage: "REVERSAL_CONFIRMED", trend,
      warning: bearishBreak ? "BEARISH" : "BULLISH",
      confirmedDirection: bearishBreak ? "PUT" : "CALL",
      swingHigh, swingLow, ema5: ema5[lastIndex], rsi14: rsi.at(-1),
      reason: bearishBreak
        ? "ราคาปิด M1 หลุด micro Swing Low ก่อนหน้า ยืนยันโครงสร้างกลับตัวลง"
        : "ราคาปิด M1 ทะลุ micro Swing High ก่อนหน้า ยืนยันโครงสร้างกลับตัวขึ้น"
    };
  }

  const currentRsi = rsi.at(-1);
  const previousRsi = rsi.at(-2);
  const recentPrices = closes.slice(-6);
  const priorPrices = closes.slice(-12, -6);
  const recentRsi = rsi.slice(-6).filter(Number.isFinite);
  const priorRsi = rsi.slice(-12, -6).filter(Number.isFinite);
  const bearishDivergence = trend === "UPTREND" && priorRsi.length && recentRsi.length &&
    extremes(recentPrices).high > extremes(priorPrices).high &&
    extremes(recentRsi).high < extremes(priorRsi).high;
  const bullishDivergence = trend === "DOWNTREND" && priorRsi.length && recentRsi.length &&
    extremes(recentPrices).low < extremes(priorPrices).low &&
    extremes(recentRsi).low > extremes(priorRsi).low;

  const range = Math.max(last.high - last.low, Number.EPSILON);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const bearishRejection = trend === "UPTREND" && last.high >= Math.max(...candles.slice(-6).map(c => c.high)) &&
    upperWick / range >= 0.55 && last.close < last.open;
  const bullishRejection = trend === "DOWNTREND" && last.low <= Math.min(...candles.slice(-6).map(c => c.low)) &&
    lowerWick / range >= 0.55 && last.close > last.open;
  const momentumFading = trend === "UPTREND"
    ? last.close - previous.close < Math.max(0, previous.close - candles.at(-3).close) * 0.5
    : trend === "DOWNTREND"
      ? previous.close - last.close < Math.max(0, candles.at(-3).close - previous.close) * 0.5
      : false;
  const warning = bearishDivergence || bearishRejection || (trend === "UPTREND" && momentumFading)
    ? "BEARISH"
    : bullishDivergence || bullishRejection || (trend === "DOWNTREND" && momentumFading)
      ? "BULLISH" : null;

  return {
    stage: warning ? "REVERSAL_WARNING" : trend === "UNCLEAR" ? "UNCLEAR" : "TREND",
    trend, warning, confirmedDirection: null, swingHigh, swingLow,
    ema5: ema5[lastIndex], rsi14: currentRsi, rsi14Previous: previousRsi,
    divergence: bearishDivergence ? "BEARISH" : bullishDivergence ? "BULLISH" : null,
    momentumFading, bearishRejection, bullishRejection,
    reason: warning
      ? "พบแรงเดิมอ่อนกำลัง/โมเมนตัมหรือ Divergence — เตือนให้ชะลอการตามเทรนด์เดิม ยังไม่ยืนยันการกลับตัว"
      : trend === "UNCLEAR" ? "EMA5 ยังไม่แสดงแนวโน้มที่ชัดเจน"
        : "แนวโน้มเดิมยังแข็งแรงตาม EMA5"
  };
}
