'use strict';

const DIRECTIONS = new Set(['CALL', 'PUT']);
const MIN_CANDLES = 4;
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
  const entryCandles = Array.isArray(data?.entryCandles) ? data.entryCandles
    : Array.isArray(candles) ? candles.slice(-MIN_CANDLES) : [];
  const contextCandles = Array.isArray(data?.contextCandles) ? data.contextCandles
    : Array.isArray(candles) ? candles.slice(0, -MIN_CANDLES) : [];
  if (!Array.isArray(candles) || candles.length < 54 || entryCandles.length < MIN_CANDLES ||
      !candles.slice(-54).every(validCandle) || !entryCandles.slice(-MIN_CANDLES).every(validCandle))
    return { error: result(engine, 'NO_SIGNAL', 0, 0, 'Insufficient or invalid 50+4 closed M1 analysis window', false) };
  const c = entryCandles.at(-1), p = entryCandles.at(-2), i = data.indicators || {};
  if (!c || !p) return { error: result(engine) };
  return { candles, contextCandles, entryCandles, c, p, i, range: rangeOf(c), body: bodyOf(c) };
}
function choose(engine, direction, score, reason) {
  if (!DIRECTIONS.has(direction) || score < 45) return result(engine, 'NO_SIGNAL', 0, 0, reason || 'No qualifying setup', true);
  return result(engine, direction, score, clamp(score), reason, true);
}

function runTrendBreakoutEngine(data) {
  const b = base(data, 'trend_breakout'); if (b.error) return b.error;
  const { contextCandles, c, range } = b, prior = contextCandles.slice(-20);
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
  const { entryCandles } = b, a = entryCandles.at(-2), c = entryCandles.at(-1), q = entryCandles.at(-3);
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
  const { contextCandles, entryCandles } = b, prior = contextCandles.slice(-15), recent = entryCandles.slice(0, -1);
  const oldRange = mean(prior.map(rangeOf)), tightRange = mean(recent.map(rangeOf)), c = entryCandles.at(-1);
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
  if (!Array.isArray(candles) || candles.length < 54 || !candles.slice(-54).every(validCandle))
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: 50 context + 4 entry closed candles are required', false);
  const now = Number.isFinite(data.now) ? data.now : Date.now();
  const latest = candles.at(-1), tickAge = data.tickAgeSeconds;
  const streamFresh = Number.isFinite(tickAge) && tickAge >= 0 && tickAge <= 25;
  const restFresh = data.allowRestFallback === true && Number.isFinite(data.ageSeconds) && data.ageSeconds <= 180;
  if (!streamFresh && !restFresh)
    return result('safety_noise_guard', 'NO_SIGNAL', 0, 0, 'VETO: live tick and permitted REST candle are stale', false);
  const recentCandles = candles.slice(-4);
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

// Nine directional analysts. System 10 is the score aggregator, not a market analyst.
const ENGINES = Object.freeze([
  runTrendBreakoutEngine, runTrendContinuationEngine, runPinBarReversalEngine,
  runCandlestickPatternEngine, runRangeBoundSwingEngine, runCompressionSqueezeEngine,
  runMomentumDivergenceEngine, runVolumeOrderFlowEngine, runPullbackRetestEngine
]);
const WEIGHTS = Object.freeze({
  trend_breakout: 1.15, trend_continuation: 1.1, pin_bar_reversal: 0.9,
  candlestick_pattern: 0.9, range_bound_swing: 1.15, compression_squeeze: 1,
  momentum_divergence: 0.85, volume_order_flow: 0.8, pullback_retest: 1.05
});
const ENGINE_GROUP = Object.freeze({
  trend_breakout: "TREND",
  trend_continuation: "TREND",
  pullback_retest: "TREND",
  pin_bar_reversal: "CANDLE",
  candlestick_pattern: "CANDLE",
  range_bound_swing: "RANGE",
  compression_squeeze: "VOLATILITY",
  momentum_divergence: "MOMENTUM",
  volume_order_flow: "VOLUME"
});
const MIN_ENGINE_SUPPORT = 2;
const MIN_INDEPENDENT_GROUPS = 2;
const MIN_DISPATCH_SCORE = 60;
const MIN_CONFLICT_MARGIN = 0.12;

function alignedConfirmations(context, direction) {
  const i = context?.indicators || {};
  const call = direction === "CALL";
  const checks = [
    (call ? Number(i.emaBullishAlignment) : Number(i.emaBearishAlignment)) >= 2,
    call ? i.plusDI > i.minusDI : i.minusDI > i.plusDI,
    Number.isFinite(i.macdHistogram) && (call ? i.macdHistogram > 0 : i.macdHistogram < 0),
    Number.isFinite(i.rsi) && (call ? i.rsi >= 45 && i.rsi <= 70 : i.rsi >= 30 && i.rsi <= 55),
    Number.isFinite(i.adx) && i.adx >= 18,
    !context?.higherTimeframe?.direction || context.higherTimeframe.direction === "UNCLEAR" ||
      context.higherTimeframe.direction === direction,
    Number.isFinite(i.volatilityRatio) && i.volatilityRatio <= 2.0
  ];
  return checks.filter(Boolean).length;
}

function centralDispatcher(results, regime, context = {}) {
  const safety = context.safetyGuard || results.find(r => r.engine === "safety_noise_guard");
  const veto = reason => ({
    signal: "STANDBY", score: 0, confidence: 0, evidenceStrength: 0,
    confidenceMeaning: "EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY",
    strategy: "AI10_DIRECTION_AGGREGATOR", reason,
    safetyGuard: safety || null, engineResults: results.filter(r => r.engine !== "safety_noise_guard"),
    aggregation: { decisionBy: "SYSTEM_10", callScore: 0, putScore: 0,
      callSupport: 0, putSupport: 0, independentGroups: 0 }
  });
  if (!safety || !safety.validity || !String(safety.reason || "").startsWith("PASS:"))
    return veto(safety?.reason || "VETO: Safety validation unavailable");

  const i = context.indicators || {};
  if (!["UPTREND", "DOWNTREND", "SIDEWAY", "RANGING", "REVERSAL"].includes(regime))
    return veto("Market regime is UNCLEAR; wait for a measurable setup");
  if (Number.isFinite(i.volatilityRatio) && i.volatilityRatio > 2.8)
    return veto("VETO: extreme M1 volatility expansion");
  if (Number.isFinite(i.volatilityRatio) && i.volatilityRatio > 2.0)
    return veto("Volatility is elevated; wait for a cleaner next-candle entry");

  const directional = results.filter(r => r.engine !== "safety_noise_guard");
  const votes = { CALL: 0, PUT: 0 }, weightTotals = { CALL: 0, PUT: 0 };
  const engines = { CALL: [], PUT: [] }, groups = { CALL: new Set(), PUT: new Set() };
  for (const r of directional) {
    if (!r.validity || !DIRECTIONS.has(r.direction)) continue;
    const weight = WEIGHTS[r.engine] || 1;
    votes[r.direction] += weight * clamp(r.score);
    weightTotals[r.direction] += weight;
    engines[r.direction].push(r.engine);
    groups[r.direction].add(ENGINE_GROUP[r.engine] || r.engine);
  }
  const callScore = Math.round(votes.CALL), putScore = Math.round(votes.PUT);
  const winner = callScore === putScore ? null : callScore > putScore ? "CALL" : "PUT";
  if (!winner) return {
    signal: "STANDBY", score: 0, confidence: 0, evidenceStrength: 0,
    confidenceMeaning: "EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY",
    strategy: "AI10_DIRECTION_AGGREGATOR",
    reason: callScore === 0 && putScore === 0
      ? "No directional setup confirmed by the nine analysts"
      : "CALL and PUT evidence are balanced; no direction selected",
    aggregation: { decisionBy: "SYSTEM_10", method: "WEIGHTED_INDEPENDENT_EVIDENCE",
      callScore, putScore, callSupport: engines.CALL.length, putSupport: engines.PUT.length,
      callGroups: [...groups.CALL], putGroups: [...groups.PUT], independentGroups: 0 },
    safetyGuard: safety, engineResults: directional
  };

  const loser = winner === "CALL" ? "PUT" : "CALL";
  const avg = weightTotals[winner] ? votes[winner] / weightTotals[winner] : 0;
  const margin = (votes[winner] - votes[loser]) / Math.max(votes[winner] + votes[loser], 1);
  const supportCount = engines[winner].length;
  const independentGroups = groups[winner].size;
  const singleEnginePass = supportCount === 1 && avg >= 70 &&
    alignedConfirmations(context, winner) >= 5;
  if ((supportCount < MIN_ENGINE_SUPPORT || independentGroups < MIN_INDEPENDENT_GROUPS) && !singleEnginePass)
    return {
      signal: "STANDBY", score: Math.round(avg), confidence: 0, evidenceStrength: 0,
      confidenceMeaning: "EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY",
      strategy: "AI10_DIRECTION_AGGREGATOR",
      reason: "Directional evidence is too concentrated in one analyst; need independent confirmation",
      aggregation: { decisionBy: "SYSTEM_10", method: "WEIGHTED_INDEPENDENT_EVIDENCE",
        callScore, putScore, callSupport: engines.CALL.length, putSupport: engines.PUT.length,
        callGroups: [...groups.CALL], putGroups: [...groups.PUT], independentGroups,
        margin: Number(margin.toFixed(3)) },
      safetyGuard: safety, engineResults: directional
    };
  if (avg < MIN_DISPATCH_SCORE)
    return veto(`Weighted directional score below minimum (${MIN_DISPATCH_SCORE})`);
  if (margin < MIN_CONFLICT_MARGIN)
    return veto("CALL/PUT conflict is too close for a reliable entry");

  const oppositeRegime = (regime === "UPTREND" && winner === "PUT") ||
    (regime === "DOWNTREND" && winner === "CALL");
  if (oppositeRegime && (independentGroups < 3 || avg < 68))
    return veto("Signal opposes the M1 trend without enough independent reversal evidence");

  const m5 = context.higherTimeframe?.direction;
  if (m5 && m5 !== "UNCLEAR" && m5 !== winner &&
      (independentGroups < 3 || !Number.isFinite(i.adx) || i.adx < 22 || avg < 68))
    return veto("M5 context conflicts with M1; stronger multi-engine reversal evidence required");

  if (regime === "SIDEWAY" || regime === "RANGING") {
    const rangeVote = engines[winner].includes("range_bound_swing");
    const breakoutVote = engines[winner].includes("trend_breakout");
    if (!rangeVote && !breakoutVote)
      return veto("Sideways market: wait for a confirmed range-boundary rejection or range breakout");
  }

  if (winner === "CALL" && i.nearResistance && !engines.CALL.includes("trend_breakout") && !engines.CALL.includes("compression_squeeze"))
    return veto("Resistance is too close to the CALL entry");
  if (winner === "PUT" && i.nearSupport && !engines.PUT.includes("trend_breakout") && !engines.PUT.includes("compression_squeeze"))
    return veto("Support is too close to the PUT entry");
  if (winner === "CALL" && Number.isFinite(i.rsi) && i.rsi > 78)
    return veto("CALL blocked: M1 RSI is overbought");
  if (winner === "PUT" && Number.isFinite(i.rsi) && i.rsi < 22)
    return veto("PUT blocked: M1 RSI is oversold");

  const totalConfiguredWeight = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const coverage = weightTotals[winner] / totalConfiguredWeight;
  const groupFactor = Math.min(1, independentGroups / 3);
  const evidenceStrength = clamp(Math.round(
    35 * (avg / 100) + 25 * Math.min(1, coverage / 0.4) +
    20 * groupFactor + 20 * Math.max(0, margin)
  ));
  const aggregation = {
    decisionBy: "SYSTEM_10", method: "WEIGHTED_INDEPENDENT_EVIDENCE",
    callScore, putScore, callSupport: engines.CALL.length, putSupport: engines.PUT.length,
    callGroups: [...groups.CALL], putGroups: [...groups.PUT], independentGroups,
    margin: Number(margin.toFixed(3)), supportCoverage: Number(coverage.toFixed(3)),
    singleEngineConfirmation: singleEnginePass
  };
  return {
    signal: winner, score: clamp(Math.round(avg)), confidence: evidenceStrength,
    evidenceStrength, confidenceMeaning: "EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY",
    strategy: "AI10_DIRECTION_AGGREGATOR",
    reason: `System 10 selected ${winner}: weighted score ${callScore} vs ${putScore}; ${supportCount}/9 analysts across ${independentGroups} independent groups`,
    aggregation, safetyGuard: safety, engineResults: directional
  };
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
  const [batch, safety] = await Promise.all([
    evaluateEngineBatch(marketData),
    Promise.resolve().then(() => runSafetyNoiseGuard(marketData)).catch(error =>
      result('safety_noise_guard', 'NO_SIGNAL', 0, 0,
        `VETO: Safety validation failed: ${error?.message || 'unknown'}`, false))
  ]);
  const decision = centralDispatcher(batch.results, marketData?.regime, {
    ...marketData, safetyGuard: safety
  });
  return {
    ...decision,
    engineResults: batch.results,
    engineSummary: {
      total: 10, directionalEngines: 9, aggregator: 1,
      fulfilled: batch.fulfilled, failed: batch.failed,
      safetyGuard: safety.validity && safety.reason.startsWith('PASS:') ? 'PASS' : 'VETO',
      safetyVeto: !(safety.validity && safety.reason.startsWith('PASS:'))
    }
  };
}
module.exports = { evaluateAllEngines, evaluateEngineBatch, centralDispatcher, runTrendBreakoutEngine,
  runTrendContinuationEngine, runPinBarReversalEngine, runCandlestickPatternEngine,
  runRangeBoundSwingEngine, runCompressionSqueezeEngine, runMomentumDivergenceEngine,
  runVolumeOrderFlowEngine, runPullbackRetestEngine, runSafetyNoiseGuard };
