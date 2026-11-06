'use strict';

const { ema } = require('../indicators/ema');
const { rsi } = require('../indicators/rsi');
const { macd } = require('../indicators/macd');
const { adx } = require('../indicators/adx');
const { volatility } = require('../indicators/volatility');
const { supportResistance } = require('../indicators/support-resistance');

const MIN_TREND_ADX = 14;

function classifyTrendRegime({ bullishAlignment, bearishAlignment, adx: adxValue, plusDI, minusDI }) {
  if (!Number.isFinite(adxValue) || !Number.isFinite(plusDI) || !Number.isFinite(minusDI)) return null;

  if (adxValue >= MIN_TREND_ADX && bullishAlignment >= 2 && plusDI > minusDI) {
    return {
      regime: 'UPTREND',
      confidence: Math.min(95, 62 + adxValue - MIN_TREND_ADX),
      reason: `Bullish EMA alignment (${bullishAlignment}/3) with ADX/DI confirmation`
    };
  }

  if (adxValue >= MIN_TREND_ADX && bearishAlignment >= 2 && minusDI > plusDI) {
    return {
      regime: 'DOWNTREND',
      confidence: Math.min(95, 62 + adxValue - MIN_TREND_ADX),
      reason: `Bearish EMA alignment (${bearishAlignment}/3) with ADX/DI confirmation`
    };
  }

  return null;
}

function scanTrend(c) {
  if (!Array.isArray(c) || c.length < 200) {
    return { regime: 'UNCLEAR', confidence: 0, reason: 'Insufficient closed candles', indicators: null };
  }

  const closes = c.map(x => x.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rv = rsi(closes);
  const m = macd(closes);
  const d = adx(c);
  const v = volatility(c);
  const sr = supportResistance(c);

  if ([e9, e21, e50, e200, rv, m?.histogram, d?.adx, d?.plusDI, d?.minusDI,
    v?.averageRange, sr?.support, sr?.resistance].some(x => !Number.isFinite(x))) {
    return { regime: 'UNCLEAR', confidence: 0, reason: 'Indicator calculation incomplete', indicators: null };
  }

  const last = c.at(-1);
  const prev = c.at(-2);
  const bullishAlignment = Number(e9 > e21) + Number(e21 > e50) + Number(e50 > e200);
  const bearishAlignment = Number(e9 < e21) + Number(e21 < e50) + Number(e50 < e200);
  const nearSupport = last.close - sr.support <= v.averageRange * 0.25;
  const nearResistance = sr.resistance - last.close <= v.averageRange * 0.25;
  const bullBreak = last.close > prev.high && last.close > e21;
  const bearBreak = last.close < prev.low && last.close < e21;

  let regime = 'UNCLEAR';
  let confidence = 0;
  let reason = 'Conflicting or weak market evidence';

  if ((bearishAlignment === 3 && bullBreak && m.histogram > 0 && rv >= 50) ||
      (bullishAlignment === 3 && bearBreak && m.histogram < 0 && rv <= 50)) {
    regime = 'REVERSAL';
    confidence = 78;
    reason = 'Structure break and momentum shift';
  } else {
    const trend = classifyTrendRegime({
      bullishAlignment,
      bearishAlignment,
      adx: d.adx,
      plusDI: d.plusDI,
      minusDI: d.minusDI
    });

    if (trend) {
      ({ regime, confidence, reason } = trend);
    } else if (d.adx < 18 && Math.abs(e9 - e21) <= v.averageRange * 0.35) {
      regime = 'SIDEWAY';
      confidence = 72;
      reason = 'Low ADX and compressed EMA spread';
    }
  }

  return {
    regime,
    confidence,
    reason,
    indicators: {
      ema9: e9,
      ema21: e21,
      ema50: e50,
      ema200: e200,
      emaBullishAlignment: bullishAlignment,
      emaBearishAlignment: bearishAlignment,
      rsi: rv,
      macdHistogram: m.histogram,
      adx: d.adx,
      plusDI: d.plusDI,
      minusDI: d.minusDI,
      support: sr.support,
      resistance: sr.resistance,
      averageRange: v.averageRange,
      volatilityRatio: v.ratio,
      nearSupport,
      nearResistance
    }
  };
}

module.exports = { scanTrend, classifyTrendRegime, MIN_TREND_ADX };
