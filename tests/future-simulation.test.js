'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateFuture, calculateAtr, applySimulationSafetyGate } = require('../simulation');

function candles(count = 40, step = 0.0001) {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * step;
    return { time: i * 60000, open: close - step * 0.3, high: close + step, low: close - step, close };
  });
}

test('ATR requires enough history and returns a positive range', () => {
  assert.equal(calculateAtr(candles(10)), null);
  assert.ok(calculateAtr(candles(30)) > 0);
});

test('future simulation returns 10, 20 and 30 second envelopes', () => {
  const result = simulateFuture(candles(), { volatilityRatio: 1.1 });
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.scenarios.map(x => x.seconds), [10, 20, 30]);
  assert.ok(result.scenarios.every(x => x.lowerBound <= x.continuationPrice && x.continuationPrice <= x.upperBound));
});

test('simulation fails closed on insufficient history', () => {
  assert.equal(simulateFuture(candles(10)).status, 'UNAVAILABLE');
});

test('simulation gate preserves non-directional STANDBY', () => {
  const input = { signal: 'STANDBY', reason: 'No setup' };
  assert.equal(applySimulationSafetyGate(input, null), input);
});

test('simulation gate blocks a directional signal when simulation is unavailable', () => {
  const result = applySimulationSafetyGate({ signal: 'CALL', score: 80 }, null);
  assert.equal(result.signal, 'STANDBY');
  assert.equal(result.simulationGate, 'BLOCKED_UNAVAILABLE');
});

test('simulation gate blocks a high reversal-risk projection', () => {
  const result = applySimulationSafetyGate({ signal: 'PUT', score: 90 }, {
    status: 'READY', direction: 'UP', reversalRisk: 0.9
  });
  assert.equal(result.signal, 'STANDBY');
  assert.equal(result.simulationGate, 'BLOCKED_REVERSAL_RISK');
});

test('simulation gate passes a low-risk aligned projection', () => {
  const result = applySimulationSafetyGate({ signal: 'CALL', score: 80 }, {
    status: 'READY', direction: 'UP', reversalRisk: 0.2
  });
  assert.equal(result.signal, 'CALL');
  assert.equal(result.simulationGate, 'PASSED');
});
