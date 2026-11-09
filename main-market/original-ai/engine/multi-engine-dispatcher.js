'use strict';

const DIRECTIONS = new Set(['CALL', 'PUT']);
const MIN_CANDLES = 30;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const rangeOf = c => Math.max(c.high - c.low, 1e-12);
const bodyOf = c => Math.abs(c.close - c.open);
const validCandle = c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
  c.low > 0 && c.close > 0 && c.high >= Math.max(c.open, c.close) &&
  c.low <= Math.min(c.open, c.close) && c.high >= c.low;

function result(engine, direction = 'NO_SIGNAL', score = 0, confidence = 0, reason = 'Insufficient evidence', validity = false) {
  return { engine, direction, score: clamp(score), confidence: clamp(confidence), reason, validity: Boolean(validity) };
}
function base(data, engine) {
  const candles = data?.candles;
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES || !candles.slice(-MIN_CANDLES).every(validCandle))
    return { error: result(engine, 'NO_SIGNAL', 0, 0, 'Insufficient or invalid OHLC history', false) };
  const c = candles.at(-1), p = candles.at(-2), i = data.indicators || {};
  if (!c || !p) return { error: result(engine) };
  return { candles, c, p, i, range: rangeOf(c), body: bodyOf(c) };
}
function choose(engine, direction, score, reason) {
  if (!DIRECTIONS.has(direction) || score < 45) return result(engine, 'NO_SIGNAL', 0, 0, reason || 'No qualifying setup', true);
  return result(engine, direction, score, clamp(score), reason, true);
}

function runTrendBreakoutEngine(data) {
  const b = base(data, 'trend_breakout'); if (b.error) return b.error;
  const { candles, c, range } = b, prior = candles.slice(-21, -1);
  const high = Math.max(...prior.map(x => x.high)), low = Math.min(...prior.map(x => x.low));
  const closeStrength = c.close > c.open ? (c.close - c.low) / range : (c.high - c.close) / range;
  if (c.close > high && closeStrength >= 0.72) return choose('trend_breakout', 'CALL', 72, 'Closed candle broke the 20-candle resistance with strong close');
  if (c.close < low && closeStrength >= 0.72) return choose('trend_breakout', 'PUT', 72, 'Closed candle broke the 20-candle support with strong close');
  return result('trend_breakout', 'NO_SIGNAL', 0, 0, 'No confirmed 20-candle range breakout', true);
}
function runTrendContinuationEngine(data) {
  const b = base(data, 'trend_continuation'); if (b.error) return b.error;
  const { c, p, i, range } = b;
  const call = Number.isFinite(i.adx) && i.adx >= 14 && i.plusDI > i.minusDI &&
    i.macdHistogram > 0 && i.rsi >= 45 && i.rsi <= 72 &&
    c.close > c.open && c.close > p.close && (c.close - c.low) / range >= 0.68;
  const put = Number.isFinite(i.adx) && i.adx >= 14 && i.minusDI > i.plusDI &&
    i.macdHistogram < 0 && i.rsi >= 28 && i.rsi <= 55 &&
    c.close < c.open && c.close < p.close && (c.high - c.close) / range >= 0.68;
  if (call) return choose('trend_continuation', 'CALL', 70, 'ADX, DI, MACD, RSI and candle flow confirm bullish continuation');
  if (put) return choose('trend_continuation', 'PUT', 70, 'ADX, DI, MACD, RSI and candle flow confirm bearish continuation');
  return result('trend_continuation', 'NO_SIGNAL', 0, 0, 'Trend continuation evidence is incomplete', true);
}
function runPinBarReversalEngine(data) {
  const b = base(data, 'pin_bar_reversal'); if (b.error) return b.error;
  const { c, i, range, body } = b, upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
  const bodyFloor = Math.max(body, range * 0.04);
  if (lower >= bodyFloor * 2 && upper <= bodyFloor * 0.8 && (i.nearSupport || i.rsi <= 32))
    return choose('pin_bar_reversal', 'CALL', 62, 'Bullish rejection wick at support/oversold area');
  if (upper >= bodyFloor * 2 && lower <= bodyFloor * 0.8 && (i.nearResistance || i.rsi >= 68))
    return choose('pin_bar_reversal', 'PUT', 62, 'Bearish rejection wick at resistance/overbought area');
  return result('pin_bar_reversal', 'NO_SIGNAL', 0, 0, 'No qualified pin-bar rejection', true);
}
function runCandlestickPatternEngine(data) {
  const b = base(data, 'candlestick_pattern'); if (b.error) return b.error;
  const { candles } = b, a = candles.at(-2), c = candles.at(-1), q = candles.at(-3);
  const bullishEngulf = a.close < a.open && c.close > c.open && c.open <= a.close && c.close >= a.open;
  const bearishEngulf = a.close > a.open && c.close < c.open && c.open >= a.close && c.close <= a.open;
  const qBody = bodyOf(q), aBody = bodyOf(a), cBody = bodyOf(c);
  const morningStar = q.close < q.open && aBody < qBody * 0.55 && c.close > c.open && c.close > (q.open + q.close) / 2;
  const eveningStar = q.close > q.open && aBody < qBody * 0.55 && c.close < c.open && c.close < (q.open + q.close) / 2;
  if (bullishEngulf || morningStar) return choose('candlestick_pattern', 'CALL', 64, bullishEngulf ? 'Bullish engulfing pattern' : 'Morning-star reversal pattern');
  if (bearishEngulf || eveningStar) return choose('candlestick_pattern', 'PUT', 64, bearishEngulf ? 'Bearish engulfing pattern' : 'Evening-star reversal pattern');
  return result('candlestick_pattern', 'NO_SIGNAL', 0, 0, 'No confirmed engulfing/star pattern', true);
}
function runRangeBoundSwingEngine(data) {
  const b = base(data, 'range_bound_swing'); if (b.error) return b.error;
  const { c, i, range } = b;
  if (!['SIDEWAY', 'RANGING'].includes(data.regime))
    return result('range_bound_swing', 'NO_SIGNAL', 0, 0, 'Inactive outside SIDEWAY/RANGING regime', true);
  const nearSupport = i.nearSupport === true, nearResistance = i.nearResistance === true;
  const bullReject = (c.close - c.low) / range >= 0.68 && c.close > c.open;
  const bearReject = (c.high - c.close) / range >= 0.68 && c.close < c.open;
  if (nearSupport && bullReject && Number.isFinite(i.rsi) && i.rsi <= 45 && (i.volatilityRatio ?? 99) <= 2.0)
    return choose('range_bound_swing', 'CALL', 68, 'Range swing: support rejection with subdued volatility and RSI confirmation');
  if (nearResistance && bearReject && Number.isFinite(i.rsi) && i.rsi >= 55 && (i.volatilityRatio ?? 99) <= 2.0)
    return choose('range_bound_swing', 'PUT', 68, 'Range swing: resistance rejection with subdued volatility and RSI confirmation');
  return result('range_bound_swing', 'NO_SIGNAL', 0, 0, 'No confirmed support/resistance swing setup', true);
}
function runCompressionSqueezeEngine(data) {
  const b = base(data, 'compression_squeeze'); if (b.error) return b.error;
  const { candles } = b, prior = candles.slice(-16, -1), recent = candles.slice(-6, -1);
  const oldRange = mean(prior.map(rangeOf)), tightRange = mean(recent.map(rangeOf)), c = candles.at(-1);
  const high = Math.max(...recent.map(x => x.high)), low = Math.min(...recent.map(x => x.low));
  if (!(oldRange > 0) || tightRange / oldRange > 0.68)
    return result('compression_squeeze', 'NO_SIGNAL', 0, 0, 'No measurable volatility compression', true);
  if (c.close > high && c.close > c.open) return choose('compression_squeeze', 'CALL', 66, 'Compression followed by bullish range expansion');
  if (c.close < low && c.close < c.open) return choose('compression_squeeze', 'PUT', 66, 'Compression followed by bearish range expansion');
  return result('compression_squeeze', 'NO_SIGNAL', 0, 0, 'Compression present but no directional release', true);
}
function rsiSeries(candles, period = 14) {
  const closes = candles.map(c => c.close), out = [];
  for (let end = period; end < closes.length; end++) {
    let gain = 0, loss = 0;
    for (let k = end - period + 1; k <= end; k++) {
      const d = closes[k] - closes[k - 1]; if (d > 0) gain += d; else loss -= d;
    }
    out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}
function runMomentumDivergenceEngine(data) {
  const b = base(data, 'momentum_divergence'); if (b.error) return b.error;
  const { candles } = b, recent = candles.slice(-12), rsis = rsiSeries(candles).slice(-12);
  if (recent.length < 12 || rsis.length < 12) return result('momentum_divergence', 'NO_SIGNAL', 0, 0, 'Insufficient RSI history for divergence', false);
  const firstLow = Math.min(...recent.slice(0, 6).map(x => x.low)), lastLow = Math.min(...recent.slice(6).map(x => x.low));
  const firstHigh = Math.max(...recent.slice(0, 6).map(x => x.high)), lastHigh = Math.max(...recent.slice(6).map(x => x.high));
  const rsiFirstLow = Math.min(...rsis.slice(0, 6)), rsiLastLow = Math.min(...rsis.slice(6));
  const rsiFirstHigh = Math.max(...rsis.slice(0, 6)), rsiLastHigh = Math.max(...rsis.slice(6));
  if (lastLow < firstLow && rsiLastLow > rsiFirstLow + 3) return choose('momentum_divergence', 'CALL', 60, 'Bullish price/RSI divergence');
  if (lastHigh > firstHigh && rsiLastHigh < rsiFirstHigh - 3) return choose('momentum_divergence', 'PUT', 60, 'Bearish price/RSI divergence');
  return result('momentum_divergence', 'NO_SIGNAL', 0, 0, 'No confirmed price/RSI divergence', true);
}
function runVolumeOrderFlowEngine(data) {
  const b = base(data, 'volume_order_flow'); if (b.error) return b.error;
  const { candles } = b, window = candles.slice(-21), volumes = window.map(c => Number(c.volume ?? c.tickVolume));
  if (!volumes.every(v => Number.isFinite(v) && v > 0))
    return result('volume_order_flow', 'NO_SIGNAL', 0, 0, 'Volume/tick-volume unavailable; no synthetic volume is inferred', false);
  const baseline = mean(volumes.slice(0, -1)), current = volumes.at(-1), c = candles.at(-1);
  if (!(baseline > 0) || current / baseline < 1.5)
    return result('volume_order_flow', 'NO_SIGNAL', 0, 0, 'No abnormal volume expansion', true);
  if (c.close > c.open) return choose('volume_order_flow', 'CALL', 58, 'Abnormal volume expansion on bullish candle');
  if (c.close < c.open) return choose('volume_order_flow', 'PUT', 58, 'Abnormal volume expansion on bearish candle');
  return result('volume_order_flow', 'NO_SIGNAL', 0, 0, 'Volume expansion without candle direction', true);
}
function runPullbackRetestEngine(data) {
  const b = base(data, 'pullback_retest'); if (b.error) return b.error;
  const { candles, i, c, p } = b, callTrend = i.ema9 > i.ema21 && i.ema21 > i.ema50;
  const putTrend = i.ema9 < i.ema21 && i.ema21 < i.ema50;
  const call = callTrend && c.low <= i.ema9 && c.close > i.ema9 && c.close > c.open && c.close > p.close;
  const put = putTrend && c.high >= i.ema9 && c.close < i.ema9 && c.close < c.open && c.close < p.close;
  if (call) return choose('pullback_retest', 'CALL', 66, 'Bullish EMA structure with pullback and reclaim');
  if (put) return choose('pullback_retest', 'PUT', 66, 'Bearish EMA structure with pullback and rejection');
  return result('pullback_retest', 'NO_SIGNAL', 0, 0, 'No confirmed EMA pullback/retest', true);
}
function runSafetyNoiseGuard(data) {
  const candles = data?.candles;
  if (!Array.isArray(candles) || candles.length < 200 || !candles.slice(-200).every(validCandle))
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: 200 valid closed candles are required', false);
  const now = Number.isFinite(data.now) ? data.now : Date.now();
  const latest = candles.at(-1), tickAge = data.tickAgeSeconds;
  const streamFresh = Number.isFinite(tickAge) && tickAge >= 0 && tickAge <= 25;
  const restFresh = data.allowRestFallback === true && Number.isFinite(data.ageSeconds) && data.ageSeconds <= 180;
  if (!streamFresh && !restFresh)
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: live tick and permitted REST candle are stale', false);
  const recentCandles = candles.slice(-3);
  const gap = recentCandles.some((c, idx, arr) => idx > 0 && c.epoch - arr[idx - 1].epoch > 120);
  if (gap) return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: missing M1 candle gap in analysis window', false);
  const i = data.indicators || {};
  if (Number.isFinite(i.volatilityRatio) && i.volatilityRatio > 2.8)
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: extreme volatility expansion', false);
  const ranges = candles.slice(-20).map(rangeOf), avg = mean(ranges);
  const last = latest ? rangeOf(latest) : 0;
  if (avg > 0 && last / avg > 3.5)
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: latest candle is an abnormal noise spike', false);
  return result('safety_noise_guard', 'NO_SIGNAL', 0, 100, 'PASS: source freshness, OHLC integrity, last-3-candle continuity and noise checks passed', true);
}

const ENGINES = Object.freeze([
  runTrendBreakoutEngine, runTrendContinuationEngine, runPinBarReversalEngine,
  runCandlestickPatternEngine, runRangeBoundSwingEngine, runCompressionSqueezeEngine,
  runMomentumDivergenceEngine, runVolumeOrderFlowEngine, runPullbackRetestEngine,
  runSafetyNoiseGuard
]);
const WEIGHTS = Object.freeze({
  trend_breakout: 1.15, trend_continuation: 1.1, pin_bar_reversal: 0.9,
  candlestick_pattern: 0.9, range_bound_swing: 1.15, compression_squeeze: 1,
  momentum_divergence: 0.85, volume_order_flow: 0.8, pullback_retest: 1.05
});
const MIN_ENGINE_SUPPORT = 2;
const MIN_DISPATCH_SCORE = 50;
const MIN_CONFLICT_MARGIN = 0.15;

function singleEngineContextPass(context, direction) {
  const i = context?.indicators || {};
  const m5 = context?.higherTimeframe?.direction;
  const emaAligned = direction === 'CALL'
    ? Number(i.emaBullishAlignment) >= 2
    : Number(i.emaBearishAlignment) >= 2;
  const diAligned = direction === 'CALL' ? i.plusDI > i.minusDI : i.minusDI > i.plusDI;
  const macdAligned = direction === 'CALL'
    ? Number.isFinite(i.macdHistogram) && i.macdHistogram > 0
    : Number.isFinite(i.macdHistogram) && i.macdHistogram < 0;
  const rsiAligned = Number.isFinite(i.rsi) && (direction === 'CALL'
    ? i.rsi >= 45 && i.rsi <= 65
    : i.rsi >= 35 && i.rsi <= 55);
  const m5Aligned = !m5 || m5 === 'UNCLEAR' || m5 === direction;
  const volatilitySafe = Number.isFinite(i.volatilityRatio) && i.volatilityRatio <= 2.0;
  return emaAligned && diAligned && macdAligned && rsiAligned && m5Aligned && volatilitySafe;
}

function centralDispatcher(results, regime, context = {}) {
  const safety = results.find(r => r.engine === 'safety_noise_guard');
  if (!safety || !safety.validity || safety.reason.startsWith('VETO:'))
    return { signal: 'STANDBY', score: 0, strategy: 'SAFETY_VETO', reason: safety?.reason || 'VETO: Safety engine unavailable', engineResults: results };
  const votes = { CALL: 0, PUT: 0 }, confidenceVotes = { CALL: 0, PUT: 0 }, engines = { CALL: [], PUT: [] };
  for (const r of results) {
    if (!r.validity || !DIRECTIONS.has(r.direction)) continue;
    const weight = WEIGHTS[r.engine] || 0;
    votes[r.direction] += weight * r.score;
    confidenceVotes[r.direction] += weight * r.confidence;
    engines[r.direction].push(r.engine);
  }
  const winner = votes.CALL === votes.PUT ? null : votes.CALL > votes.PUT ? 'CALL' : 'PUT';
  const loser = winner === 'CALL' ? 'PUT' : 'CALL';
  if (!winner) return { signal: 'STANDBY', score: 0, strategy: 'MULTI_ENGINE', reason: 'No directional engine consensus', engineResults: results };
  const total = votes.CALL + votes.PUT, margin = total > 0 ? (votes[winner] - votes[loser]) / total : 0;
  const supportCount = engines[winner].length;
  const winningWeight = Math.max(1, engines[winner].reduce((s, name) => s + (WEIGHTS[name] || 1), 0));
  const score = clamp(Math.round(votes[winner] / winningWeight));
  const confidence = clamp(Math.round(confidenceVotes[winner] / winningWeight));
  const highConvictionSingle = supportCount === 1 && engines[loser].length === 0 &&\n    score >= 65 && singleEngineContextPass(context, winner);\n  if ((!highConvictionSingle && supportCount < MIN_ENGINE_SUPPORT) || score < MIN_DISPATCH_SCORE || margin < MIN_CONFLICT_MARGIN) {
    return { signal: 'STANDBY', score, confidence, strategy: 'MULTI_ENGINE', reason: `Insufficient engine consensus: ${winner} support ${supportCount}/9, score floor ${MIN_DISPATCH_SCORE}, conflict margin ${Math.round(margin * 100)}%`, engineResults: results };
  }
  if (['SIDEWAY', 'RANGING'].includes(regime) && !engines[winner].includes('range_bound_swing') && !highConvictionSingle) {
    return { signal: 'STANDBY', score, confidence, strategy: 'MULTI_ENGINE', reason: 'SIDEWAY mode requires a confirmed Range-Bound Swing engine vote', engineResults: results };
  }
  return { signal: winner, score, confidence, singleEngineConfirmation: highConvictionSingle, strategy: engines[winner].includes('range_bound_swing') ? 'RANGE_BOUND_SWING' : regime === 'REVERSAL' ? 'REVERSAL' : winner === 'CALL' ? 'UPTREND' : 'DOWNTREND', reason: highConvictionSingle ? `High-conviction single-engine ${winner}: score ${score}; M1 context independently confirmed` : `Multi-engine consensus ${winner}: ${supportCount} supporting engines; ${engines[loser].length} conflicting engines; margin ${Math.round(margin * 100)}%`, engineResults: results };
}
async function evaluateEngineBatch(marketData, engineList = ENGINES) {
  const settled = await Promise.allSettled(engineList.map(engine => Promise.resolve().then(() => engine(marketData))));
  const results = settled.map((item, idx) => item.status === 'fulfilled'
    ? item.value
    : result(engineList[idx].engineName || engineList[idx].name || `engine_${idx + 1}`,
      'NO_SIGNAL', 0, 0, `Engine failure: ${item.reason?.message || 'unknown'}`, false));
  return { results, fulfilled: settled.filter(x => x.status === 'fulfilled').length,
    failed: settled.filter(x => x.status === 'rejected').length };
}
async function evaluateAllEngines(marketData) {
  const batch = await evaluateEngineBatch(marketData);
  const results = batch.results;
  const decision = centralDispatcher(results, marketData?.regime, marketData);
  return { ...decision, engineResults: results, engineSummary: {
    total: results.length, fulfilled: batch.fulfilled, failed: batch.failed,
    safetyVeto: !results.some(r => r.engine === 'safety_noise_guard' && r.validity && !r.reason.startsWith('VETO:'))
  }};
}
module.exports = { evaluateAllEngines, evaluateEngineBatch, centralDispatcher, runTrendBreakoutEngine,
  runTrendContinuationEngine, runPinBarReversalEngine, runCandlestickPatternEngine,
  runRangeBoundSwingEngine, runCompressionSqueezeEngine, runMomentumDivergenceEngine,
  runVolumeOrderFlowEngine, runPullbackRetestEngine, runSafetyNoiseGuard };
