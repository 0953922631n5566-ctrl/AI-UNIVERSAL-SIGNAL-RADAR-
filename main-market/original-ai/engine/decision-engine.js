'use strict';

const MIN_SCORE = 35;

function hasStrongTrendMomentum(ctx, candidate) {
  const i = ctx?.indicators;
  if (!i || !candidate || !['UPTREND', 'DOWNTREND'].includes(candidate.strategy) || i.adx < 18) return false;
  if (candidate.signal === 'CALL') return i.plusDI > i.minusDI && i.macdHistogram > 0 && i.rsi >= 22 && i.rsi <= 78;
  if (candidate.signal === 'PUT') return i.minusDI > i.plusDI && i.macdHistogram < 0 && i.rsi >= 22 && i.rsi <= 78;
  return false;
}

function decide(ctx, candidate) {
  if (!ctx || ctx.regime === 'UNCLEAR' || !ctx.indicators) {
    return {
      signal: 'STANDBY', regime: ctx?.regime || 'UNCLEAR', score: 0,
      reason: ctx?.reason || 'Market context unavailable', strategy: 'NONE'
    };
  }

  if (!candidate || !['CALL', 'PUT'].includes(candidate.signal) || candidate.score < MIN_SCORE) {
    return {
      signal: 'STANDBY', regime: ctx.regime, score: candidate?.score || 0,
      reason: candidate?.reason || 'No valid strategy candidate',
      strategy: candidate?.strategy || ctx.regime
    };
  }

  const i = ctx.indicators;
  const strongMomentum = hasStrongTrendMomentum(ctx, candidate);

  // Preserve the market-risk gate independently of any historical analogue.
  if (i.volatilityRatio > 2.8 || (i.volatilityRatio > 2.2 && !strongMomentum)) {
    return {
      signal: 'STANDBY', regime: ctx.regime, score: candidate.score,
      reason: 'Extreme volatility; entry blocked', strategy: candidate.strategy
    };
  }

  if (candidate.strategy === 'UPTREND' && candidate.signal === 'CALL' &&
      i.nearResistance && !(strongMomentum && candidate.score >= MIN_SCORE)) {
    return {
      signal: 'STANDBY', regime: ctx.regime, score: candidate.score,
      reason: 'Resistance nearby; bullish continuation not strong enough',
      strategy: candidate.strategy
    };
  }

  if (candidate.strategy === 'DOWNTREND' && candidate.signal === 'PUT' &&
      i.nearSupport && !(strongMomentum && candidate.score >= MIN_SCORE)) {
    return {
      signal: 'STANDBY', regime: ctx.regime, score: candidate.score,
      reason: 'Support nearby; bearish continuation not strong enough',
      strategy: candidate.strategy
    };
  }

  return { ...candidate, regime: ctx.regime };
}

module.exports = { decide, MIN_SCORE, hasStrongTrendMomentum };
