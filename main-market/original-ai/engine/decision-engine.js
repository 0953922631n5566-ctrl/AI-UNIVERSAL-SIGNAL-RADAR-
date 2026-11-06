'use strict';

const MIN_SCORE = 60;

function hasStrongTrendMomentum(ctx, candidate) {
  const i = ctx?.indicators;
  if (!i || !candidate || !['UPTREND', 'DOWNTREND'].includes(candidate.strategy) || i.adx < 20) return false;
  if (candidate.signal === 'CALL') return i.plusDI > i.minusDI && i.macdHistogram > 0 && i.rsi >= 22 && i.rsi <= 78;
  if (candidate.signal === 'PUT') return i.minusDI > i.plusDI && i.macdHistogram < 0 && i.rsi >= 22 && i.rsi <= 78;
  return false;
}

function decide(ctx, candidate) {
  if (!ctx || ctx.regime === 'UNCLEAR' || !ctx.indicators) {
    return {
      signal: 'STANDBY',
      regime: ctx?.regime || 'UNCLEAR',
      score: 0,
      reason: ctx?.reason || 'Market context unavailable',
      strategy: 'NONE'
    };
  }

  if (!candidate || !['CALL', 'PUT'].includes(candidate.signal) || candidate.score < MIN_SCORE) {
    return {
      signal: 'STANDBY',
      regime: ctx.regime,
      score: candidate?.score || 0,
      reason: candidate?.reason || 'No valid strategy candidate',
      strategy: candidate?.strategy || ctx.regime
    };
  }

  const i = ctx.indicators;
  const strongMomentum = hasStrongTrendMomentum(ctx, candidate);
  const historical = ctx.historicalAssistant;
  const historicalReady = historical?.decisionReady === true &&
    ['CALL', 'PUT'].includes(historical.direction) &&
    Number.isFinite(historical.directionalSharePercent) &&
    Number.isFinite(historical.analogueCount) && historical.analogueCount >= 12;

  // The historical model is a secondary safety check, never a signal generator.
  // It can block a conflicting borderline candidate, but cannot create or flip a signal.
  if (historicalReady && historical.direction !== candidate.signal && candidate.score < 80) {
    return {
      signal: 'STANDBY',
      regime: ctx.regime,
      score: candidate.score,
      reason: `Historical evidence conflicts (${historical.direction} ${historical.directionalSharePercent}% from ${historical.analogueCount} analogues); Original AI candidate held for safety`,
      strategy: candidate.strategy,
      assistantCheck: 'CONFLICT_BLOCK'
    };
  }

  if (i.volatilityRatio > 2.8 || (i.volatilityRatio > 2.2 && !strongMomentum)) {
    return {
      signal: 'STANDBY',
      regime: ctx.regime,
      score: candidate.score,
      reason: 'Extreme volatility; entry blocked',
      strategy: candidate.strategy
    };
  }

  if (candidate.strategy === 'UPTREND' && candidate.signal === 'CALL' &&
      i.nearResistance && !(strongMomentum && candidate.score >= MIN_SCORE)) {
    return {
      signal: 'STANDBY',
      regime: ctx.regime,
      score: candidate.score,
      reason: 'Resistance nearby; bullish continuation not strong enough',
      strategy: candidate.strategy
    };
  }

  if (candidate.strategy === 'DOWNTREND' && candidate.signal === 'PUT' &&
      i.nearSupport && !(strongMomentum && candidate.score >= MIN_SCORE)) {
    return {
      signal: 'STANDBY',
      regime: ctx.regime,
      score: candidate.score,
      reason: 'Support nearby; bearish continuation not strong enough',
      strategy: candidate.strategy
    };
  }

  return {
    ...candidate,
    regime: ctx.regime,
    ...(historicalReady ? {
      assistantCheck: historical.direction === candidate.signal ? 'CONFIRMED' : 'STRONG_ORIGINAL_OVERRIDE'
    } : {})
  };
}

module.exports = { decide, MIN_SCORE, hasStrongTrendMomentum };
