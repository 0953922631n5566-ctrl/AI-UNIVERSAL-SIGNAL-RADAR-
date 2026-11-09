'use strict';

const MIN_SCORE = 45;
const MIN_TREND_ADX = 14;
const M5_COUNTERTREND_ADX = 25;
const M5_COUNTERTREND_SCORE = 65;

function hasStrongTrendMomentum(ctx, candidate) {
  const i = ctx?.indicators, direction = candidate?.signal;
  if (!i || !candidate || !['UPTREND', 'DOWNTREND'].includes(candidate.strategy) ||
      !Number.isFinite(i.adx) || i.adx < MIN_TREND_ADX) return false;
  if (Number.isFinite(i.volumeRatio) && i.volumeRatio < 0.75) return false;
  if (direction === 'CALL') return i.plusDI > i.minusDI &&
    i.macdHistogram > 0 && i.rsi >= 45 && i.rsi <= 72;
  if (direction === 'PUT') return i.minusDI > i.plusDI &&
    i.macdHistogram < 0 && i.rsi >= 28 && i.rsi <= 55;
  return false;
}

function standby(ctx, candidate, reason) {
  return { signal: 'STANDBY', regime: ctx?.regime || 'UNCLEAR',
    score: candidate?.score || 0, confidence: candidate?.confidence || 0, reason,
    strategy: candidate?.strategy || ctx?.regime || 'NONE',
    engineResults: candidate?.engineResults || null, engineSummary: candidate?.engineSummary || null };
}

function decide(ctx, candidate) {
  if (!ctx || ctx.regime === 'UNCLEAR' || !ctx.indicators)
    return standby(ctx, candidate, ctx?.reason || 'Market context unavailable');
  if (ctx.regime === 'SIDEWAY' || ctx.regime === 'RANGING') {
    const rangeVote = candidate?.strategy === 'RANGE_BOUND_SWING' &&
      candidate?.engineResults?.some(r => r.engine === 'range_bound_swing' &&
        r.direction === candidate.signal && r.validity);
    const i = ctx.indicators || {};
    const rangeSafe = Number.isFinite(i.volatilityRatio) && i.volatilityRatio <= 2.0 &&
      (candidate?.signal === 'CALL'
        ? i.nearSupport === true && Number.isFinite(i.rsi) && i.rsi <= 45
        : i.nearResistance === true && Number.isFinite(i.rsi) && i.rsi >= 55);
    const safetyPass = candidate?.engineResults?.some(r =>
      r.engine === 'safety_noise_guard' && r.validity && r.reason.startsWith('PASS:'));
    if (!rangeVote || !rangeSafe || !safetyPass || !['CALL', 'PUT'].includes(candidate?.signal) ||
        !Number.isFinite(candidate?.score) || candidate.score < 50)
      return standby(ctx, candidate, 'Sideways/choppy regime; directional entry blocked unless Range-Bound Swing confirmation and safety checks pass');
    return { ...candidate, regime: ctx.regime };
  }
  if (!candidate || !['CALL', 'PUT'].includes(candidate.signal) ||
      !Number.isFinite(candidate.score) || candidate.score < MIN_SCORE)
    return standby(ctx, candidate, candidate?.reason || `Candidate score below strict minimum (${MIN_SCORE})`);

  const i = ctx.indicators, direction = candidate.signal;
  const expectedStrategy = direction === 'CALL' ? 'UPTREND' : 'DOWNTREND';
  if (ctx.regime !== 'REVERSAL' && candidate.strategy !== expectedStrategy)
    return standby(ctx, candidate, 'Signal direction conflicts with detected trend regime');

  const strongMomentum = hasStrongTrendMomentum(ctx, candidate);
  if (['UPTREND', 'DOWNTREND'].includes(candidate.strategy) && !strongMomentum)
    return standby(ctx, candidate, `Trend confirmation incomplete (ADX >= ${MIN_TREND_ADX}, directional DI, MACD, RSI and volume support required when available)`);

  // Transitional/UNCLEAR M5 is not a veto. A clear opposite M5 needs exceptional
  // M1 evidence, preserving a guard against ordinary timeframe conflicts.
  const m5Direction = ctx.higherTimeframe?.direction;
  if (m5Direction && m5Direction !== 'UNCLEAR' && m5Direction !== direction) {
    const exceptionalM1 = strongMomentum && i.adx >= M5_COUNTERTREND_ADX &&
      candidate.score >= M5_COUNTERTREND_SCORE &&
      (!Number.isFinite(i.volumeRatio) || i.volumeRatio >= 1);
    if (!exceptionalM1)
      return standby(ctx, candidate, 'M5 trend conflicts with M1; stronger M1 breakout evidence required');
  }

  if (i.volatilityRatio > 2.8 || (i.volatilityRatio > 2.0 && !strongMomentum))
    return standby(ctx, candidate, 'Volatility expansion is too high for a reliable entry');
  if (direction === 'CALL' && i.nearResistance && !strongMomentum)
    return standby(ctx, candidate, 'Resistance nearby; bullish continuation not sufficiently confirmed');
  if (direction === 'PUT' && i.nearSupport && !strongMomentum)
    return standby(ctx, candidate, 'Support nearby; bearish continuation not sufficiently confirmed');
  return { ...candidate, regime: ctx.regime };
}

module.exports = { decide, MIN_SCORE, MIN_TREND_ADX, M5_COUNTERTREND_ADX,
  M5_COUNTERTREND_SCORE, hasStrongTrendMomentum };
