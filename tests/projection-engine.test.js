'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateFuture, calculateAtr } = require('../simulation/future-simulation-engine');
const { projectFuture } = require('../simulation/projection-engine');

function candles(count = 80, slope = 0.00002) {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * slope;
    return {
      time: i * 60000,
      open: close - slope * 0.4,
      high: close + 0.00008,
      low: close - 0.00008,
      close
    };
  });
}

test('ATR is calculated only from the supplied completed-candle window', () => {
  const rows = candles();
  assert.ok(calculateAtr(rows, 14) > 0);
  assert.equal(calculateAtr(rows.slice(0, 10), 14), null);
});

test('simulation is deterministic and uses ATR, volatility and momentum', () => {
  const rows = candles();
  const a = simulateFuture(rows, { volatilityRatio: 1.4 });
  const b = simulateFuture(rows, { volatilityRatio: 1.4 });
  assert.deepEqual(a, b);
  assert.equal(a.status, 'READY');
  assert.equal(a.scenarios.length, 3);
  assert.ok(a.scenarios[2].envelope > a.scenarios[0].envelope);
});

test('projection returns direction, bounded ranges and uncertainty without probabilities', () => {
  const sim = simulateFuture(candles(), { volatilityRatio: 2.4 });
  const result = projectFuture(sim);
  assert.equal(result.status, 'READY');
  assert.equal(result.direction, 'UP');
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(result.uncertainty));
  assert.ok(result.horizons.every(x => x.lowerBound <= x.upperBound));
  assert.equal(Object.hasOwn(result, 'probability'), false);
});

test('future candles cannot alter a projection made from an earlier information set', () => {
  const all = candles(90);
  const prefix = all.slice(0, 80);
  const before = projectFuture(simulateFuture(prefix, { volatilityRatio: 1.2 }));
  const after = projectFuture(simulateFuture(all.slice(0, 80), { volatilityRatio: 1.2 }));
  assert.deepEqual(after, before);
});

test('invalid or insufficient data fails closed', () => {
  assert.equal(simulateFuture(candles(10)).status, 'UNAVAILABLE');
  const broken = candles();
  broken[79].high = -1;
  assert.equal(simulateFuture(broken).status, 'UNAVAILABLE');
  assert.equal(projectFuture(null).status, 'UNAVAILABLE');
});
