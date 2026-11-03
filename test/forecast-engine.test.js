const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateNextCandle } = require('../forecast-engine');

test('insufficient history safely returns STANDBY for the next candle only', () => {
  const result = evaluateNextCandle([], 1.1, null);
  assert.equal(result.signal, 'STANDBY');
  assert.equal(result.horizon, 1);
});

test('next-candle forecast returns a bounded rule-agreement score', () => {
  const candles = [];
  for (let i = 0; i < 80; i++) {
    const close = 1.08 + i * 0.000012 + Math.sin(i / 2) * 0.000035;
    const open = close - (i % 3 === 0 ? 0.000018 : -0.000008);
    candles.push({
      open,
      high: Math.max(open, close) + 0.00002,
      low: Math.min(open, close) - 0.00002,
      close
    });
  }
  const result = evaluateNextCandle(candles, candles.at(-1).close + 0.00001, 0.00002);
  assert.ok(['CALL', 'PUT', 'STANDBY'].includes(result.signal));
  assert.ok(Number.isInteger(result.agreementScore));
  assert.ok(result.agreementScore >= 0 && result.agreementScore <= 100);
  assert.match(result.agreementVotes, /^\d+\/6$/);
  assert.equal(result.horizon, 1);
  assert.ok(result.reason.length > 0);
});

test('missing live price cannot generate a directional forecast', () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({
    open: 1.1 + i * 0.00001,
    high: 1.1002 + i * 0.00001,
    low: 1.0998 + i * 0.00001,
    close: 1.1 + i * 0.00001
  }));
  const result = evaluateNextCandle(candles, NaN, null);
  assert.equal(result.signal, 'STANDBY');
});
