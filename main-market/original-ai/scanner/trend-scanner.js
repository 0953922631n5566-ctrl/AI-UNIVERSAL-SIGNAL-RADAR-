'use strict';

const { ema } = require('../indicators/ema');
const { rsi } = require('../indicators/rsi');
const { macd } = require('../indicators/macd');
const { adx } = require('../indicators/adx');
const { volatility } = require('../indicators/volatility');
const { supportResistance } = require('../indicators/support-resistance');

const MIN_TREND_ADX = 14;
const MIN_M5_CANDLES = 22;

function candleEpoch(candle, index) {
  if (Number.isFinite(candle?.epoch)) return candle.epoch;
  if (Number.isFinite(candle?.time)) return Math.floor(candle.time / 1000);
  return index * 60;
}

function calculateVolumeRatio(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return null;
  const values = candles.slice(-(lookback + 1)).map(c =>
    Number.isFinite(c?.volume) ? c.volume :
    Number.isFinite(c?.tick_volume) ? c.tick_volume : null
  );
  if (values.some(v => v === null || v < 0)) return null;
  const baseline = values.slice(0, -1).reduce((sum, value) => sum + value, 0) / lookback;
  return baseline > 0 ? values.at(-1) / baseline : null;
}

function buildHigherTimeframeContext(candles) {
  if (!Array.isArray(candles) || candles.length < MIN_M5_CANDLES * 5) {
    return { direction: 'UNCLEAR', candleCount: 0, reason: 'Insufficient M1 history to derive M5 confirmation' };
  }
  const groups = [];
  let current = [];
  let bucket = null;
  let previousEpoch = null;
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const epoch = candleEpoch(candle, index);
    const nextBucket = Math.floor(epoch / 300);
    if (bucket !== null && (nextBucket !== bucket || epoch - previousEpoch !== 60)) {
      if (current.length === 5) groups.push(current);
      current = [];
    }
    if (bucket !== nextBucket) bucket = nextBucket;
    current.push(candle);
    previousEpoch = epoch;
    if (current.length > 5) current = [candle];
  }
  if (current.length === 5) groups.push(current);

  const bars = groups.map(group => ({
    open: group[0].open, high: Math.max(...group.map(c => c.high)),
    low: Math.min(...group.map(c => c.low)), close: group.at(-1).close
  }));
  if (bars.length < MIN_M5_CANDLES) {
    return { direction: 'UNCLEAR', candleCount: bars.length, reason: 'M5 bars are incomplete or contain gaps' };
  }
  const closes = bars.map(bar => bar.close);
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  const priorEma21 = ema(closes.slice(0, -1), 21), close = closes.at(-1);
  if (![ema9, ema21, priorEma21, close].every(Number.isFinite)) {
    return { direction: 'UNCLEAR', candleCount: bars.length, reason: 'M5 indicator calculation incomplete' };
  }
  let direction = 'UNCLEAR';
  if (ema9 > ema21 && close > ema21 && ema21 > priorEma21) direction = 'CALL';
  if (ema9 < ema21 && close < ema21 && ema21 < priorEma21) direction = 'PUT';
  return { direction, candleCount: bars.length, ema9, ema21, close,
    reason: direction === 'UNCLEAR' ? 'M5 trend is flat or conflicting' : `M5 ${direction} trend context` };
}

/**
 * Regime classification is led by closed M1 evidence. M5 remains separately
 * reported and is evaluated by the decision engine only when clearly opposite.
 */
function classifyTrendRegime({ bullishAlignment, bearishAlignment, adx: adxValue, plusDI, minusDI, higherTimeframe }) {
  if (![adxValue, plusDI, minusDI].every(Number.isFinite)) return null;
  if (adxValue >= MIN_TREND_ADX && bullishAlignment >= 2 && plusDI > minusDI) {
    return { regime: 'UPTREND', confidence: Math.min(95, 62 + adxValue - MIN_TREND_ADX),
      reason: `Bullish M1 EMA alignment (${bullishAlignment}/3), ADX and DI confirmed; M5 ${higherTimeframe?.direction || 'UNCLEAR'} context` };
  }
  if (adxValue >= MIN_TREND_ADX && bearishAlignment >= 2 && minusDI > plusDI) {
    return { regime: 'DOWNTREND', confidence: Math.min(95, 62 + adxValue - MIN_TREND_ADX),
      reason: `Bearish M1 EMA alignment (${bearishAlignment}/3), ADX and DI confirmed; M5 ${higherTimeframe?.direction || 'UNCLEAR'} context` };
  }
  return null;
}

function scanTrend(c) {
  if (!Array.isArray(c) || c.length < 200) {
    return { regime: 'UNCLEAR', confidence: 0, reason: 'Insufficient closed candles', indicators: null };
  }
  const higherTimeframe = buildHigherTimeframeContext(c);
  const closes = c.map(x => x.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rv = rsi(closes), m = macd(closes), d = adx(c), v = volatility(c), sr = supportResistance(c);
  if ([e9, e21, e50, e200, rv, m?.histogram, d?.adx, d?.plusDI, d?.minusDI,
    v?.averageRange, sr?.support, sr?.resistance].some(x => !Number.isFinite(x))) {
    return { regime: 'UNCLEAR', confidence: 0, reason: 'Indicator calculation incomplete', indicators: null, higherTimeframe };
  }
  const last = c.at(-1), prev = c.at(-2);
  const bullishAlignment = Number(e9 > e21) + Number(e21 > e50) + Number(e50 > e200);
  const bearishAlignment = Number(e9 < e21) + Number(e21 < e50) + Number(e50 < e200);
  const nearSupport = last.close - sr.support <= v.averageRange * 0.25;
  const nearResistance = sr.resistance - last.close <= v.averageRange * 0.25;
  const bullBreak = last.close > prev.high && last.close > e21;
  const bearBreak = last.close < prev.low && last.close < e21;
  let regime = 'UNCLEAR', confidence = 0, reason = 'Conflicting or weak market evidence';
  if ((bearishAlignment === 3 && bullBreak && m.histogram > 0 && rv >= 50 && higherTimeframe.direction === 'CALL') ||
      (bullishAlignment === 3 && bearBreak && m.histogram < 0 && rv <= 50 && higherTimeframe.direction === 'PUT')) {
    regime = 'REVERSAL'; confidence = 78;
    reason = 'M1 structure break, momentum shift and M5 reversal context confirmed';
  } else {
    const trend = classifyTrendRegime({ bullishAlignment, bearishAlignment, adx: d.adx,
      plusDI: d.plusDI, minusDI: d.minusDI, higherTimeframe });
    if (trend) ({ regime, confidence, reason } = trend);
    else if (d.adx < MIN_TREND_ADX && Math.abs(e9 - e21) <= v.averageRange * 0.35) {
      regime = 'SIDEWAY'; confidence = 72;
      reason = 'Low ADX and compressed EMA spread; entries blocked';
    }
  }
  return { regime, confidence, reason, higherTimeframe, indicators: {
    ema9: e9, ema21: e21, ema50: e50, ema200: e200,
    emaBullishAlignment: bullishAlignment, emaBearishAlignment: bearishAlignment,
    rsi: rv, macdHistogram: m.histogram, adx: d.adx, plusDI: d.plusDI, minusDI: d.minusDI,
    support: sr.support, resistance: sr.resistance, averageRange: v.averageRange,
    volatilityRatio: v.ratio, volumeRatio: calculateVolumeRatio(c), nearSupport, nearResistance
  }};
}

module.exports = { scanTrend, classifyTrendRegime, buildHigherTimeframeContext, calculateVolumeRatio, MIN_TREND_ADX };
