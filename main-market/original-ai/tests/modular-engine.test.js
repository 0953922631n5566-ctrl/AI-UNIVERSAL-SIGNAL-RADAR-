'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ema } = require('../indicators/ema'), { rsi } = require('../indicators/rsi'), { adx } = require('../indicators/adx');
const { scanTrend, buildHigherTimeframeContext } = require('../scanner/trend-scanner');
const { routeStrategy } = require('../engine/strategy-router'), { decide } = require('../engine/decision-engine');
const { createSignalCache } = require('../engine/signal-cache'), { analyzeMarket } = require('../engine/analyze-market');
const { evaluateDowntrend } = require('../strategies/downtrend'), { evaluateUptrend } = require('../strategies/uptrend');
function mk(values) { return values.map((close, i) => ({ time: i * 60000, open: close - .0001, high: close + .0002, low: close - .0002, close })); }
const alignedCall = { direction: 'CALL' };
const alignedPut = { direction: 'PUT' };

test('EMA needs sufficient history', () => assert.equal(ema([1, 2], 3), null));
test('RSI rising sequence is bounded', () => assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1)), 100));
test('ADX needs sufficient candles', () => assert.equal(adx(mk(Array.from({ length: 20 }, (_, i) => i + 1))), null));
test('scanner fails closed below 200 candles', () => assert.equal(scanTrend(mk([1, 2, 3])).regime, 'UNCLEAR'));
test('M5 timeframe is aggregated locally from M1 bars', () => {
  const bars = Array.from({ length: 200 }, (_, i) => { const close = 1 + i * .00002; return { ...mk([close])[0], time: i * 60000 }; });
  assert.equal(buildHigherTimeframeContext(bars).direction, 'CALL');
});
test('router never runs a strategy for UNCLEAR', () => assert.equal(routeStrategy({ regime: 'UNCLEAR' }).signal, 'STANDBY'));
test('decision engine blocks unclear regime', () => assert.equal(decide({ regime: 'UNCLEAR' }, null).signal, 'STANDBY'));
test('decision engine blocks SIDEWAY candidates', () => {
  const out = decide({ regime: 'SIDEWAY', higherTimeframe: alignedCall, indicators: { volatilityRatio: 1 } },
    { strategy: 'SIDEWAY', signal: 'CALL', score: 100 });
  assert.equal(out.signal, 'STANDBY');
});
test('RAM cache is keyed by candle timestamp', () => { const c = createSignalCache(); c.set(1, { signal: 'CALL' }); assert.equal(c.get(1).signal, 'CALL'); assert.equal(c.get(2), null); });
test('full analyzer always returns valid signal enum', () => { const x = analyzeMarket(mk(Array.from({ length: 200 }, (_, i) => 1 + i * .00001))); assert.ok(['CALL', 'PUT', 'STANDBY'].includes(x.signal)); });
test('trend CALL needs M5, ADX, score and directional evidence', () => {
  const ctx = { regime: 'UPTREND', higherTimeframe: alignedCall, indicators: { volatilityRatio: 1, nearSupport: false, nearResistance: false, adx: 25, plusDI: 28, minusDI: 10, macdHistogram: .0002, rsi: 60 } };
  assert.equal(decide(ctx, { strategy: 'UPTREND', signal: 'CALL', score: 60 }).signal, 'CALL');
  assert.equal(decide({ ...ctx, higherTimeframe: alignedPut }, { strategy: 'UPTREND', signal: 'CALL', score: 100 }).signal, 'STANDBY');
});
test('trend PUT needs M5, ADX, score and directional evidence', () => {
  const ctx = { regime: 'DOWNTREND', higherTimeframe: alignedPut, indicators: { volatilityRatio: 1, nearSupport: false, nearResistance: false, adx: 25, minusDI: 28, plusDI: 10, macdHistogram: -.0002, rsi: 40 } };
  assert.equal(decide(ctx, { strategy: 'DOWNTREND', signal: 'PUT', score: 60 }).signal, 'PUT');
});
test('strong CALL can pass nearby resistance only with full momentum confirmation', () => {
  const ctx = { regime: 'UPTREND', higherTimeframe: alignedCall, indicators: { volatilityRatio: 1, nearSupport: false, nearResistance: true, adx: 30, plusDI: 28, minusDI: 12, macdHistogram: .0002, rsi: 65 } };
  assert.equal(decide(ctx, { strategy: 'UPTREND', signal: 'CALL', score: 80 }).signal, 'CALL');
});
test('volatility expansion and M5 disagreement block a candidate', () => {
  const ctx = { regime: 'DOWNTREND', higherTimeframe: alignedCall, indicators: { volatilityRatio: 2.5, nearSupport: true, nearResistance: false, adx: 31, minusDI: 30, plusDI: 10, macdHistogram: -.0003, rsi: 38 } };
  assert.equal(decide(ctx, { strategy: 'DOWNTREND', signal: 'PUT', score: 100 }).signal, 'STANDBY');
});
test('downtrend strategy recognizes strong bearish continuation', () => {
  const candles = [{ open: 1.101, high: 1.102, low: 1.100, close: 1.101 }, { open: 1.101, high: 1.1012, low: 1.098, close: 1.0985 }];
  const indicators = { ema9: 1.100, adx: 29, minusDI: 28, plusDI: 11, rsi: 39, macdHistogram: -.0004 };
  const out = evaluateDowntrend({ indicators, latest: candles[1], candles });
  assert.equal(out.signal, 'PUT'); assert.ok(out.score >= 60);
});
test('uptrend strategy recognizes strong bullish continuation', () => {
  const candles = [{ open: 1.098, high: 1.099, low: 1.097, close: 1.098 }, { open: 1.098, high: 1.101, low: 1.0978, close: 1.1005 }];
  const indicators = { ema9: 1.099, adx: 29, plusDI: 28, minusDI: 11, rsi: 61, macdHistogram: .0004 };
  const out = evaluateUptrend({ indicators, latest: candles[1], candles });
  assert.equal(out.signal, 'CALL'); assert.ok(out.score >= 60);
});
