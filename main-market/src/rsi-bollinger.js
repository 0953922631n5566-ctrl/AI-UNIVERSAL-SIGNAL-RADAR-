const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

function rsiFromAverages(gain, loss) {
  if (loss <= 0) return gain > 0 ? 100 : 50;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate Wilder RSI(14) and Bollinger Bands(20, 2) from closed M1 candles.
 * Bollinger squeeze is context only; it never selects CALL or PUT by itself.
 */
export function calculateRsiBollinger(candles, rsiPeriod = 14, bbPeriod = 20, multiplier = 2) {
  if (!Array.isArray(candles) ||
      candles.length < Math.max(rsiPeriod + 1, bbPeriod + 1) ||
      !candles.every(c => c && Number.isFinite(c.close))) {
    return { ready: false, reason: "INSUFFICIENT_VALID_CANDLES" };
  }

  const closes = candles.map(c => c.close);
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }

  let averageGain = mean(gains.slice(0, rsiPeriod));
  let averageLoss = mean(losses.slice(0, rsiPeriod));
  const rsiValues = [rsiFromAverages(averageGain, averageLoss)];
  for (let i = rsiPeriod; i < gains.length; i++) {
    averageGain = (averageGain * (rsiPeriod - 1) + gains[i]) / rsiPeriod;
    averageLoss = (averageLoss * (rsiPeriod - 1) + losses[i]) / rsiPeriod;
    rsiValues.push(rsiFromAverages(averageGain, averageLoss));
  }

  const bands = [];
  for (let end = bbPeriod - 1; end < closes.length; end++) {
    const window = closes.slice(end - bbPeriod + 1, end + 1);
    const middle = mean(window);
    const variance = mean(window.map(value => (value - middle) ** 2));
    const deviation = Math.sqrt(variance);
    const upper = middle + multiplier * deviation;
    const lower = middle - multiplier * deviation;
    const bandwidth = middle !== 0 ? (upper - lower) / Math.abs(middle) : 0;
    const percentB = upper !== lower ? (closes[end] - lower) / (upper - lower) : 0.5;
    bands.push({ middle, upper, lower, bandwidth, percentB });
  }

  const current = bands.at(-1);
  const previous = bands.at(-2);
  const priorWidths = bands.slice(Math.max(0, bands.length - 21), -1).map(band => band.bandwidth);
  const baselineWidth = mean(priorWidths);
  const bandwidthRatio = baselineWidth > 0 ? current.bandwidth / baselineWidth : 1;
  const rsi = rsiValues.at(-1);
  const previousRsi = rsiValues.at(-2) ?? rsi;
  const rsiRising = rsi > previousRsi;
  const rsiFalling = rsi < previousRsi;
  const close = closes.at(-1);

  return {
    ready: true,
    rsi,
    previousRsi,
    rsiRising,
    rsiFalling,
    upper: current.upper,
    middle: current.middle,
    lower: current.lower,
    percentB: current.percentB,
    bandwidth: current.bandwidth,
    bandwidthRatio,
    squeeze: priorWidths.length >= 5 && bandwidthRatio <= 0.80,
    previousPercentB: previous?.percentB ?? current.percentB,
    callRsiAligned: rsi >= 50 && rsi <= 70 && rsiRising,
    putRsiAligned: rsi <= 50 && rsi >= 30 && rsiFalling,
    callBollingerAligned: close > current.middle && current.percentB <= 1.05,
    putBollingerAligned: close < current.middle && current.percentB >= -0.05
  };
}

function rsiScore(indicators, direction) {
  if (!indicators?.ready) return 0;
  const value = indicators.rsi;
  if (direction === "CALL") {
    const zone = value < 50 ? clamp((value - 30) / 20) : value <= 68 ? 1 : clamp((80 - value) / 12);
    return 0.75 * zone + 0.25 * (indicators.rsiRising ? 1 : 0);
  }
  const zone = value > 50 ? clamp((70 - value) / 20) : value >= 32 ? 1 : clamp((value - 20) / 12);
  return 0.75 * zone + 0.25 * (indicators.rsiFalling ? 1 : 0);
}

function bollingerScore(indicators, direction) {
  if (!indicators?.ready) return 0;
  const value = indicators.percentB;
  if (direction === "CALL") {
    const location = clamp((value - 0.5) / 0.35);
    const extensionPenalty = value > 1.05 ? clamp((1.15 - value) / 0.10) : 1;
    return location * extensionPenalty;
  }
  const location = clamp((0.5 - value) / 0.35);
  const extensionPenalty = value < -0.05 ? clamp((value + 0.15) / 0.10) : 1;
  return location * extensionPenalty;
}

export function priceActionConfirmation(indicators, direction) {
  return {
    rsi: rsiScore(indicators, direction),
    bollinger: bollingerScore(indicators, direction),
    squeeze: Boolean(indicators?.ready && indicators.squeeze)
  };
}
