'use strict';

const MIN_CONTINUATION_ADX = 18;
const MIN_CONTINUATION_SCORE = 45;

function evaluateTrendContinuation(x, direction) {
  const i = x?.indicators, c = x?.latest, p = x?.candles?.at(-2);
  const call = direction === 'CALL', signal = call ? 'CALL' : 'PUT';
  if (!i || !c || !p) return { signal: 'STANDBY', score: 0, reason: 'Missing trend context' };
  if (!Number.isFinite(i.adx) || i.adx < MIN_CONTINUATION_ADX)
    return { signal: 'STANDBY', score: 0, reason: `Trend strength below ADX ${MIN_CONTINUATION_ADX}` };
  const range = Math.max(c.high - c.low, 1e-12);
  const body = call ? (c.close - c.open) / range : (c.open - c.close) / range;
  const closeStrength = call ? (c.close - c.low) / range : (c.high - c.close) / range;
  const candleFlow = (call ? c.close > c.open && c.close > p.close : c.close < c.open && c.close < p.close) &&
    body >= 0.30 && closeStrength >= 0.68;
  const diAligned = call ? i.plusDI > i.minusDI : i.minusDI > i.plusDI;
  const macdAligned = call ? i.macdHistogram > 0 : i.macdHistogram < 0;
  const momentumAligned = diAligned && macdAligned;
  const pullback = call ? c.low <= i.ema9 || c.close <= i.ema9 * 1.0002
    : c.high >= i.ema9 || c.close >= i.ema9 * 0.9998;
  const reclaim = call ? c.close > i.ema9 && c.close > c.open && c.close > p.close
    : c.close < i.ema9 && c.close < c.open && c.close < p.close;
  const rsiAligned = call ? i.rsi >= 45 && i.rsi <= 72 : i.rsi >= 28 && i.rsi <= 55;
  const volumeSupported = Number.isFinite(i.volumeRatio) && i.volumeRatio >= 1;
  const score = (diAligned ? 10 : 0) + (rsiAligned ? 20 : 0) +
    (macdAligned ? 10 : 0) + (candleFlow ? 25 : 0) +
    (pullback && reclaim ? 25 : 0) + (volumeSupported ? 10 : 0);
  const continuation = momentumAligned && candleFlow;
  if (score >= MIN_CONTINUATION_SCORE && (continuation || pullback && reclaim))
    return { signal, score: Math.min(100, score),
      reason: continuation ? (call ? 'Strong bullish continuation candle' : 'Strong bearish continuation candle')
        : (call ? 'Uptrend pullback and bullish momentum confirmed' : 'Downtrend pullback and bearish momentum confirmed') };
  return { signal: 'STANDBY', score,
    reason: call ? 'Uptrend entry confirmation incomplete' : 'Downtrend entry confirmation incomplete' };
}
module.exports = { evaluateTrendContinuation, MIN_CONTINUATION_ADX, MIN_CONTINUATION_SCORE };
