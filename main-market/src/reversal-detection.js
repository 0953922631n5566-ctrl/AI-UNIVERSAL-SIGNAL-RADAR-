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
  return { high: Math.max(...values), low: Math.min(...values) };
}

function atr14(candles) {
  const ranges = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low - candles[i].close)
  ));
  const recent = ranges.slice(-14);
  return recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
}

/**
 * Deterministic M1 guard:
 * - EMA5 slope shifts and S/R fakeouts are detected only on closed candles.
 * - Fakeout CALL = sweep below prior swing low + lower-wick rejection + EMA5 turns up.
 * - Fakeout PUT = sweep above prior swing high + upper-wick rejection + EMA5 turns down.
 * - Sideways/flat conditions fail closed to STANDBY before Gemini can emit a direction.
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
  const atr = atr14(candles);
  const slopeNow = ema5[lastIndex] - ema5[lastIndex - 1];
  const slopePrevious = ema5[lastIndex - 1] - ema5[lastIndex - 2];
  const slopeFloor = Math.max(Number.EPSILON, atr * 0.02);
  const slopeShiftToPositive = slopePrevious <= slopeFloor && slopeNow > slopeFloor;
  const slopeShiftToNegative = slopePrevious >= -slopeFloor && slopeNow < -slopeFloor;
  const ema5Rising = slopeNow > slopeFloor;
  const ema5Falling = slopeNow < -slopeFloor;
  const trend = last.close > ema5[lastIndex] && ema5Rising
    ? "UPTREND"
    : last.close < ema5[lastIndex] && ema5Falling
      ? "DOWNTREND" : "UNCLEAR";
  const priorTrend = previous.close > ema5[lastIndex - 1] && slopePrevious > slopeFloor
    ? "UPTREND"
    : previous.close < ema5[lastIndex - 1] && slopePrevious < -slopeFloor
      ? "DOWNTREND" : "UNCLEAR";

  const range = Math.max(last.high - last.low, Number.EPSILON);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const bullishClose = last.close > last.open || last.close > previous.close;
  const bearishClose = last.close < last.open || last.close < previous.close;

  // False-breakout reversal: wick must sweep a completed swing level, close back inside,
  // and EMA5 must turn in the rejection direction on this same closed M1 candle.
  const bearTrap = last.low < swingLow && last.close > swingLow &&
    lowerWick / range >= 0.45 && slopeShiftToPositive && bullishClose;
  const bullTrap = last.high > swingHigh && last.close < swingHigh &&
    upperWick / range >= 0.45 && slopeShiftToNegative && bearishClose;
  if (bearTrap || bullTrap) {
    const direction = bearTrap ? "CALL" : "PUT";
    return {
      stage: "REVERSAL_CONFIRMED", trend, warning: bearTrap ? "BULLISH" : "BEARISH",
      confirmedDirection: direction, pattern: bearTrap ? "BEAR_TRAP" : "BULL_TRAP",
      swingHigh, swingLow, ema5: ema5[lastIndex], ema5Slope: slopeNow,
      slopePrevious, slopeShiftToPositive, slopeShiftToNegative, atr14: atr,
      rsi14: rsi.at(-1),
      reason: bearTrap
        ? "BEAR TRAP: ราคากวาดหลุด Swing Low แล้วปิดกลับเหนือแนวรับ พร้อม EMA5 หักหัวขึ้น"
        : "BULL TRAP: ราคากวาดทะลุ Swing High แล้วปิดกลับใต้แนวต้าน พร้อม EMA5 หักหัวลง"
    };
  }

  // EMA5 slope-shift entry preparation. Gemini must independently agree before release.
  if (slopeShiftToPositive && last.close > ema5[lastIndex] && bullishClose) {
    return {
      stage: "SLOPE_REVERSAL", trend: "UPTREND", warning: "BULLISH",
      confirmedDirection: "CALL", pattern: "EMA5_SLOPE_SHIFT_UP",
      swingHigh, swingLow, ema5: ema5[lastIndex], ema5Slope: slopeNow,
      slopePrevious, slopeShiftToPositive, slopeShiftToNegative, atr14: atr,
      reason: "EMA5 Slope Reversal: EMA5 เปลี่ยนจากลง/ราบเป็นชี้ขึ้น และราคายืนยันฝั่ง CALL"
    };
  }
  if (slopeShiftToNegative && last.close < ema5[lastIndex] && bearishClose) {
    return {
      stage: "SLOPE_REVERSAL", trend: "DOWNTREND", warning: "BEARISH",
      confirmedDirection: "PUT", pattern: "EMA5_SLOPE_SHIFT_DOWN",
      swingHigh, swingLow, ema5: ema5[lastIndex], ema5Slope: slopeNow,
      slopePrevious, slopeShiftToPositive, slopeShiftToNegative, atr14: atr,
      reason: "EMA5 Slope Reversal: EMA5 เปลี่ยนจากขึ้น/ราบเป็นชี้ลง และราคายืนยันฝั่ง PUT"
    };
  }

  const bearishBreak = priorTrend === "UPTREND" && last.close < swingLow;
  const bullishBreak = priorTrend === "DOWNTREND" && last.close > swingHigh;
  if (bearishBreak || bullishBreak) {
    return {
      stage: "REVERSAL_CONFIRMED", trend,
      warning: bearishBreak ? "BEARISH" : "BULLISH",
      confirmedDirection: bearishBreak ? "PUT" : "CALL",
      pattern: bearishBreak ? "SWING_BREAK_DOWN" : "SWING_BREAK_UP",
      swingHigh, swingLow, ema5: ema5[lastIndex], ema5Slope: slopeNow,
      slopePrevious, slopeShiftToPositive, slopeShiftToNegative, atr14: atr,
      rsi14: rsi.at(-1),
      reason: bearishBreak
        ? "ราคาปิด M1 หลุด micro Swing Low ก่อนหน้า ยืนยันโครงสร้างกลับตัวลง"
        : "ราคาปิด M1 ทะลุ micro Swing High ก่อนหน้า ยืนยันโครงสร้างกลับตัวขึ้น"
    };
  }

  const recent8 = candles.slice(-8);
  const recentRange = Math.max(...recent8.map(c => c.high)) - Math.min(...recent8.map(c => c.low));
  const slopeFlat = Math.abs(slopeNow) <= slopeFloor &&
    Math.abs(ema5[lastIndex] - ema5[Math.max(0, lastIndex - 3)]) <= atr * 0.18;
  const rangePosition = recentRange > 0
    ? (last.close - Math.min(...recent8.map(c => c.low))) / recentRange : 0.5;
  const midrange = rangePosition >= 0.30 && rangePosition <= 0.70;
  const smallBody = Math.abs(last.close - last.open) <= atr * 0.30;
  const weakMomentum = Math.abs(last.close - candles[lastIndex - 3].close) <= atr * 0.35;
  const sideways = slopeFlat && (recentRange <= atr * 4 || (midrange && smallBody && weakMomentum));
  if (sideways) {
    return {
      stage: "SIDEWAY_STANDBY", trend: "UNCLEAR", warning: null, confirmedDirection: null,
      pattern: "SIDEWAY_NO_TRADE", swingHigh, swingLow, ema5: ema5[lastIndex],
      ema5Slope: slopeNow, slopePrevious, atr14: atr, rangePosition,
      reason: "STANDBY: ตลาดไซด์เวย์ EMA5 แบนหรือแรงส่งไม่ชัดเจน — งดออก CALL/PUT"
    };
  }

  const priorRsi = rsi.slice(-12, -6).filter(Number.isFinite);
  const recentRsi = rsi.slice(-6).filter(Number.isFinite);
  const priorPrices = closes.slice(-12, -6);
  const recentPrices = closes.slice(-6);
  const bearishDivergence = trend === "UPTREND" && priorRsi.length && recentRsi.length &&
    extremes(recentPrices).high > extremes(priorPrices).high &&
    extremes(recentRsi).high < extremes(priorRsi).high;
  const bullishDivergence = trend === "DOWNTREND" && priorRsi.length && recentRsi.length &&
    extremes(recentPrices).low < extremes(priorPrices).low &&
    extremes(recentRsi).low > extremes(priorRsi).low;
  const bearishRejection = trend === "UPTREND" &&
    last.high >= Math.max(...candles.slice(-6).map(c => c.high)) &&
    upperWick / range >= 0.55 && last.close < last.open;
  const bullishRejection = trend === "DOWNTREND" &&
    last.low <= Math.min(...candles.slice(-6).map(c => c.low)) &&
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
    trend, warning, confirmedDirection: null, pattern: null, swingHigh, swingLow,
    ema5: ema5[lastIndex], ema5Slope: slopeNow, slopePrevious,
    slopeShiftToPositive, slopeShiftToNegative, atr14: atr,
    rsi14: rsi.at(-1), divergence: bearishDivergence ? "BEARISH" : bullishDivergence ? "BULLISH" : null,
    momentumFading, bearishRejection, bullishRejection,
    reason: warning
      ? "พบแรงเดิมอ่อนกำลัง/โมเมนตัมหรือ Divergence — เตือนให้ชะลอการตามเทรนด์เดิม ยังไม่ยืนยันการกลับตัว"
      : trend === "UNCLEAR" ? "EMA5 ยังไม่แสดงแนวโน้มที่ชัดเจน"
        : "แนวโน้มเดิมยังแข็งแรงตาม EMA5"
  };
}
