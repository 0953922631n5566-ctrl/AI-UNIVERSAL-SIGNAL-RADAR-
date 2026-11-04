'use strict';

// Experimental, deterministic what-if projection. This is NOT a price predictor.
// It projects a range envelope from recent ATR, volatility and directional momentum.
const HORIZONS_SECONDS = Object.freeze([10, 20, 30]);

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const ranges = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    ranges.push(trueRange(candles[i], candles[i - 1].close));
  }
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function simulateFuture(candles, indicators = {}, options = {}) {
  const horizons = options.horizonsSeconds || HORIZONS_SECONDS;
  if (!Array.isArray(candles) || candles.length < 20) {
    return { status: 'UNAVAILABLE', reason: 'Insufficient candle history', scenarios: [] };
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const atr = calculateAtr(candles, 14);
  if (!Number.isFinite(atr) || atr <= 0 ||
      ![latest.open, latest.high, latest.low, latest.close, previous.close].every(Number.isFinite)) {
    return { status: 'UNAVAILABLE', reason: 'Invalid ATR or candle data', scenarios: [] };
  }

  const candleRange = Math.max(latest.high - latest.low, 1e-12);
  const body = latest.close - latest.open;
  const momentum = (latest.close - previous.close) / atr;
  const bodyMomentum = body / atr;
  const direction = momentum > 0.025 ? 'UP' : momentum < -0.025 ? 'DOWN' : 'FLAT';
  const volatilityRatio = Number.isFinite(indicators.volatilityRatio) ? indicators.volatilityRatio : 1;
  const wickAgainst = direction === 'UP'
    ? (latest.high - latest.close) / candleRange
    : direction === 'DOWN' ? (latest.close - latest.low) / candleRange : 0.5;
  const expansionRisk = clamp((volatilityRatio - 1.35) / 1.5, 0, 1);
  const opposingWickRisk = clamp((wickAgainst - 0.35) / 0.55, 0, 1);
  const momentumRisk = clamp(0.45 - Math.abs(momentum) * 1.8, 0, 0.45);
  const reversalRisk = clamp(0.12 + expansionRisk * 0.38 + opposingWickRisk * 0.32 + momentumRisk, 0, 1);

  const scenarios = horizons.map(seconds => {
    const fraction = seconds / 60;
    const drift = atr * momentum * fraction;
    const envelope = atr * Math.sqrt(fraction) * (1 + expansionRisk * 0.5);
    return {
      seconds,
      basePrice: latest.close,
      continuationPrice: latest.close + drift,
      lowerBound: latest.close + drift - envelope,
      upperBound: latest.close + drift + envelope
    };
  });

  return {
    status: 'READY',
    model: 'ATR_MOMENTUM_ENVELOPE_V1',
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

module.exports = { simulateFuture, calculateAtr, HORIZONS_SECONDS };
