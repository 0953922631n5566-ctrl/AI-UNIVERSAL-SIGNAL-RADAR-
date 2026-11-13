const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function emaSeries(values, period = 5) {
  const multiplier = 2 / (period + 1);
  let current = values[0];
  const output = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

/**
 * Shadow-only detector for the observed failure mode:
 * a PUT is released near the end of a bearish move, then the next M1 candle
 * rebounds bullish. It never changes CALL/PUT/STANDBY by itself.
 */
export function assessBullishReversalRisk(candles) {
  if (!Array.isArray(candles) || candles.length < 6 ||
      !candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
        c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) &&
        c.high >= c.low)) {
    return { ready: false, wouldBlockPut: false, level: "UNKNOWN", reason: "INSUFFICIENT_OR_INVALID_OHLC" };
  }

  const current = candles.at(-1);
  const previous = candles.at(-2);
  const range = Math.max(current.high - current.low, 1e-12);
  const bodyRatio = Math.abs(current.close - current.open) / range;
  const lowerWickRatio = (Math.min(current.open, current.close) - current.low) / range;
  const closeLocation = (current.close - current.low) / range;

  let bearishRun = 0;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (candles[i].close >= candles[i].open) break;
    bearishRun++;
  }
  const priorBearish = candles.slice(Math.max(0, candles.length - 1 - Math.max(3, bearishRun)), -1)
    .filter(c => c.close < c.open);
  const priorBodyRatios = priorBearish.map(c => {
    const candleRange = Math.max(c.high - c.low, 1e-12);
    return Math.abs(c.close - c.open) / candleRange;
  });
  const priorMeanBodyRatio = mean(priorBodyRatios);
  const bodyContraction = priorMeanBodyRatio > 0 &&
    bodyRatio <= priorMeanBodyRatio * 0.72;

  const bullishRejection = lowerWickRatio >= 0.35 && closeLocation >= 0.58;
  const closesRecovering = current.close > previous.close;
  const lowsRecovering = current.low > previous.low;

  const ema = emaSeries(candles.map(c => c.close), 5);
  const slopeNow = ema.at(-1) - ema.at(-2);
  const slopePrevious = ema.at(-2) - ema.at(-3);
  const emaSlopeImproving = slopeNow > slopePrevious;
  const positiveShift = closesRecovering || lowsRecovering || emaSlopeImproving;

  const evidenceCount = [bullishRejection, bodyContraction, positiveShift].filter(Boolean).length;
  const wouldBlockPut = bearishRun >= 2 && evidenceCount >= 2 &&
    bullishRejection && (bodyContraction || positiveShift);

  return {
    ready: true,
    mode: "OBSERVE_ONLY",
    wouldBlockPut,
    level: wouldBlockPut ? "HIGH" : evidenceCount === 1 ? "WATCH" : "LOW",
    bearishRun,
    bodyRatio: Number(bodyRatio.toFixed(3)),
    priorMeanBodyRatio: Number(priorMeanBodyRatio.toFixed(3)),
    lowerWickRatio: Number(lowerWickRatio.toFixed(3)),
    closeLocation: Number(closeLocation.toFixed(3)),
    bodyContraction,
    bullishRejection,
    closesRecovering,
    lowsRecovering,
    emaSlopeImproving,
    evidenceCount,
    reasons: [
      bearishRun >= 2 ? "PRIOR_BEARISH_RUN" : null,
      bullishRejection ? "LOWER_WICK_REJECTION_WITH_HIGH_CLOSE" : null,
      bodyContraction ? "BEARISH_BODY_CONTRACTION" : null,
      closesRecovering ? "CLOSE_RECOVERY" : null,
      lowsRecovering ? "LOW_RECOVERY" : null,
      emaSlopeImproving ? "EMA5_SLOPE_IMPROVING" : null
    ].filter(Boolean)
  };
}
