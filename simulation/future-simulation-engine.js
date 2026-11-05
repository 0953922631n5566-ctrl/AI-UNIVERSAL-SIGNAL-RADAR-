'use strict';

// Deterministic what-if scenarios from completed M1 candles.
// This is a range model, not a point-price predictor and not a probability model.
const DEFAULT_HORIZONS_SECONDS = Object.freeze([10, 20, 30]);
const MIN_CANDLES = 20;
const ATR_PERIOD = 14;

function finiteCandle(c) {
  return c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= c.low;
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

function calculateAtr(candles, period = ATR_PERIOD) {
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 1 ||
      candles.length < period + 1 || !candles.every(finiteCandle)) return null;
  const start = candles.length - period;
  let atr = 0;
  for (let i = start; i < candles.length; i++) {
    atr += trueRange(candles[i], candles[i - 1].close);
  }
  return atr / period;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateMomentum(candles, atr) {
  // Weighted close-to-close movement over the last three completed intervals.
  const n = candles.length;
  const changes = [1, 2, 3].map(k => candles[n - k].close - candles[n - k - 1].close);
  const weighted = changes[0] * 0.5 + changes[1] * 0.3 + changes[2] * 0.2;
  return clamp(weighted / atr, -1, 1);
}

function simulateFuture(candles, indicators = {}, options = {}) {
  const horizons = options.horizonsSeconds || DEFAULT_HORIZONS_SECONDS;
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES + 1 ||
      !candles.every(finiteCandle)) {
    return { status: 'UNAVAILABLE', reason: 'Insufficient or invalid completed M1 candles', scenarios: [] };
  }
  if (!Array.isArray(horizons) || !horizons.length ||
      horizons.some(x => !Number.isFinite(x) || x <= 0 || x > 60)) {
    return { status: 'UNAVAILABLE', reason: 'Invalid projection horizons', scenarios: [] };
  }

  const latest = candles[candles.length - 1];
  const atr = calculateAtr(candles, ATR_PERIOD);
  if (!Number.isFinite(atr) || atr <= 0) {
    return { status: 'UNAVAILABLE', reason: 'ATR unavailable', scenarios: [] };
  }

  const suppliedVolatility = indicators && indicators.volatilityRatio;
  const volatilityRatio = Number.isFinite(suppliedVolatility) && suppliedVolatility > 0
    ? suppliedVolatility : 1;
  const momentum = calculateMomentum(candles, atr);
  const direction = momentum > 0.08 ? 'UP' : momentum < -0.08 ? 'DOWN' : 'NEUTRAL';

  // Volatility expands the envelope; opposing candle structure raises uncertainty.
  const expansion = clamp((volatilityRatio - 1) / 1.8, 0, 1.5);
  const candleRange = Math.max(latest.high - latest.low, atr * 0.05);
  const body = latest.close - latest.open;
  const bodyAlignment = direction === 'UP' ? body / candleRange
    : direction === 'DOWN' ? -body / candleRange : 0;
  const momentumAlignment = direction === 'NEUTRAL' ? 0 : Math.sign(momentum) * bodyAlignment;
  const reversalRisk = clamp(
    0.18 + expansion * 0.28 + (momentumAlignment < 0 ? Math.abs(momentumAlignment) * 0.35 : 0) +
    (Math.abs(momentum) < 0.12 ? 0.12 : 0),
    0, 0.95
  );

  const scenarios = horizons.map(seconds => {
    const fraction = seconds / 60;
    const drift = atr * momentum * fraction * 0.55;
    const envelope = atr * Math.sqrt(fraction) * (1 + expansion * 0.45) *
      (1 + reversalRisk * 0.25);
    return Object.freeze({
      seconds,
      basePrice: latest.close,
      continuationPrice: latest.close + drift,
      lowerBound: latest.close + drift - envelope,
      upperBound: latest.close + drift + envelope,
      envelope
    });
  });

  return {
    status: 'READY',
    model: 'DETERMINISTIC_ATR_VOLATILITY_MOMENTUM_ENVELOPE_V2',
    asOf: latest.time ?? null,
    basePrice: latest.close,
    atr,
    momentum,
    direction,
    volatilityRatio,
    reversalRisk,
    scenarios
  };
}

module.exports = {
  simulateFuture,
  calculateAtr,
  calculateMomentum,
  DEFAULT_HORIZONS_SECONDS,
  HORIZONS_SECONDS: DEFAULT_HORIZONS_SECONDS
};
