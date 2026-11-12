const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/**
 * Calculate Kaufman's Adaptive Moving Average and Wilder DMI/ADX from closed candles.
 * ADX measures trend strength only; +DI/-DI supply direction.
 */
export function calculateKamaDmiAdx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 2 ||
      !candles.every(c => c && [c.high, c.low, c.close].every(Number.isFinite))) {
    return { ready: false, reason: "INSUFFICIENT_VALID_CANDLES" };
  }

  const closes = candles.map(c => c.close);
  const fast = 2 / (2 + 1);
  const slow = 2 / (30 + 1);
  let kama = mean(closes.slice(0, period));
  let previousKama = kama;
  for (let i = period; i < closes.length; i++) {
    const change = Math.abs(closes[i] - closes[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(closes[j] - closes[j - 1]);
    const efficiencyRatio = volatility > 0 ? change / volatility : 0;
    const smoothing = Math.pow(efficiencyRatio * (fast - slow) + slow, 2);
    previousKama = kama;
    kama += smoothing * (closes[i] - kama);
  }

  const trueRanges = [];
  const plusMoves = [];
  const minusMoves = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
    plusMoves.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusMoves.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlus = plusMoves.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinus = minusMoves.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues = [];
  let plusDI = 0;
  let minusDI = 0;
  let adx = 0;
  for (let i = period - 1; i < trueRanges.length; i++) {
    if (i >= period) {
      smoothedTR = smoothedTR - smoothedTR / period + trueRanges[i];
      smoothedPlus = smoothedPlus - smoothedPlus / period + plusMoves[i];
      smoothedMinus = smoothedMinus - smoothedMinus / period + minusMoves[i];
    }
    plusDI = smoothedTR > 0 ? 100 * smoothedPlus / smoothedTR : 0;
    minusDI = smoothedTR > 0 ? 100 * smoothedMinus / smoothedTR : 0;
    const denominator = plusDI + minusDI;
    dxValues.push(denominator > 0 ? 100 * Math.abs(plusDI - minusDI) / denominator : 0);
    if (dxValues.length === period) adx = mean(dxValues);
    else if (dxValues.length > period) adx = ((adx * (period - 1)) + dxValues.at(-1)) / period;
  }

  const close = closes.at(-1);
  const kamaRising = kama > previousKama;
  const kamaFalling = kama < previousKama;
  const adxStrength = clamp((adx - 14) / 11);
  return {
    ready: true,
    kama,
    previousKama,
    kamaRising,
    kamaFalling,
    closeAboveKama: close > kama,
    closeBelowKama: close < kama,
    plusDI,
    minusDI,
    adx,
    adxStrength,
    callKamaAligned: close > kama && kamaRising,
    putKamaAligned: close < kama && kamaFalling,
    callDmiAligned: plusDI > minusDI,
    putDmiAligned: minusDI > plusDI
  };
}

export function directionalConfirmation(indicators, direction) {
  if (!indicators?.ready) return { kama: 0, dmi: 0, adxStrength: 0, total: 0 };
  const call = direction === "CALL";
  const kama = (call ? indicators.callKamaAligned : indicators.putKamaAligned) ? 1 : 0;
  const dmiAligned = call ? indicators.callDmiAligned : indicators.putDmiAligned;
  // ADX never chooses direction. It only scales the weight of the +DI/-DI direction check.
  const dmi = dmiAligned ? 0.25 + 0.75 * indicators.adxStrength : 0;
  return { kama, dmi, adxStrength: indicators.adxStrength, total: 0.25 * kama + 0.20 * dmi };
}
