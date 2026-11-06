'use strict';

const MIN_SCORE = 45;
const MIN_TREND_ADX = 22;

function hasStrongTrendMomentum(ctx, candidate) {
  const i = ctx?.indicators;
  const direction = candidate?.signal;
  const higherTimeframe = ctx?.higherTimeframe?.direction;
  if (!i || !candidate || !['UPTREND', 'DOWNTREND'].includes(candidate.strategy) ||
      !Number.isFinite(i.adx) || i.adx < MIN_TREND_ADX) return false;
  if (direction === 'CALL') {
    return higherTimeframe === 'CALL' && i.plusDI > i.minusDI &&
      i.macdHistogram > 0 && i.rsi >= 45 && i.rsi <= 72;
  }
  if (direction === 'PUT') {
    return higherTimeframe === 'PUT' && i.minusDI > i.plusDI &&
      i.macdHistogram < 0 && i.rsi >= 28 && i.rsi <= 55;
  }
  return false;
}

function standby(ctx, candidate, reason) {
  return {
    signal: 'STANDBY',
    regime: ctx?.regime || 'UNCLEAR',
    score: candidate?.score || 0,
    reason,
    strategy: candidate?.strategy || ctx?.regime || 'NONE'
  };
}

function decide(ctx, candidate) {
  if (!ctx || ctx.regime === 'UNCLEAR' || !ctx.indicators) {
    return standby(ctx, candidate, ctx?.reason || 'Market context unavailable');
  }

  // Sideways/range conditions are deliberately non-tradable in this release.
  // A high local score cannot override a choppy market regime.
  if (ctx.regime === 'SIDEWAY' || ctx.regime === 'RANGING') {
    return standby(ctx, candidate, 'Sideways/choppy regime; directional entry blocked');
  }

  if (!candidate || !['CALL', 'PUT'].includes(candidate.signal) ||
      !Number.isFinite(candidate.score) || candidate.score < MIN_SCORE) {
    return standby(ctx, candidate, candidate?.reason || `Candidate score below strict minimum (${MIN_SCORE})`);
  }

  const i = ctx.indicators;
  const direction = candidate.signal;
  const expectedStrategy = direction === 'CALL' ? 'UPTREND' : 'DOWNTREND';
  if (ctx.regime !== 'REVERSAL' && candidate.strategy !== expectedStrategy) {
    return standby(ctx, candidate, 'Signal direction conflicts with detected trend regime');
  }

  // Every directional candidate, including a reversal, must agree with the
  // independently aggregated M5 context derived from closed M1 candles.
  if (ctx.higherTimeframe?.direction !== direction) {
    return standby(ctx, candidate, 'M5 higher-timeframe confirmation does not agree');
  }

  const strongMomentum = hasStrongTrendMomentum(ctx, candidate);
  if (['UPTREND', 'DOWNTREND'].includes(candidate.strategy) && !strongMomentum) {
    return standby(ctx, candidate, `Trend confirmation incomplete (ADX >= ${MIN_TREND_ADX}, DI, MACD, RSI and M5 alignment required)`);
  }

  if (i.volatilityRatio > 2.8 || (i.volatilityRatio > 2.0 && !strongMomentum)) {
    return standby(ctx, candidate, 'Volatility expansion is too high for a reliable entry');
  }

  if (direction === 'CALL' && i.nearResistance && !strongMomentum) {
    return standby(ctx, candidate, 'Resistance nearby; bullish continuation not sufficiently confirmed');
  }
  if (direction === 'PUT' && i.nearSupport && !strongMomentum) {
    return standby(ctx, candidate, 'Support nearby; bearish continuation not sufficiently confirmed');
  }

  return { ...candidate, regime: ctx.regime };
}

module.exports = { decide, MIN_SCORE, MIN_TREND_ADX, hasStrongTrendMomentum };
