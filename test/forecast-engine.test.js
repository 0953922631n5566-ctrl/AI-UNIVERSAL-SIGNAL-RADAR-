const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTwoHorizons } = require('../forecast-engine');

test('insufficient history safely returns STANDBY for both horizons', () => {
  const result = evaluateTwoHorizons([], 1.1, null);
  assert.equal(result.nextCandle.signal, 'STANDBY');
  assert.equal(result.followingCandle.signal, 'STANDBY');
});

test('both forecasts return independent, bounded rule-agreement scores', () => {
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
  const result = evaluateTwoHorizons(candles, candles.at(-1).close + 0.00001, 0.00002);
  for (const horizon of [result.nextCandle, result.followingCandle]) {
    assert.ok(['CALL', 'PUT', 'STANDBY'].includes(horizon.signal));
    assert.ok(Number.isInteger(horizon.agreementScore));
    assert.ok(horizon.agreementScore >= 0 && horizon.agreementScore <= 100);
    assert.match(horizon.agreementVotes, /^\d+\/6$/);
    assert.ok(horizon.reason.length > 0);
  }
  assert.equal(result.nextCandle.horizon, 1);
  assert.equal(result.followingCandle.horizon, 2);
});

test('missing live price cannot generate a directional forecast', () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({
    open: 1.1 + i * 0.00001,
    high: 1.1002 + i * 0.00001,
    low: 1.0998 + i * 0.00001,
    close: 1.1 + i * 0.00001
  }));
  const result = evaluateTwoHorizons(candles, NaN, null);
  assert.equal(result.nextCandle.signal, 'STANDBY');
  assert.equal(result.followingCandle.signal, 'STANDBY');
});
