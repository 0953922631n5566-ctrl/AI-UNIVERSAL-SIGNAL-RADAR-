'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeMainMarket } = require('../engine/main-market-adapter');
const { applySafetyGate } = require('../engine/safety-gate');
const { ROUND16 } = require('../engine/round16-parameters');

const candidate = { signal: 'CALL', score: 80, strategy: 'UPTREND', reason: 'Candidate' };
const simulation = {
  ready: true, status: 'READY', signal: 'CALL', candleTime: 60000,
  riskScore: 0.5, volatilityRatio: 1.2, adx: 25, rangeAtrRatio: 1.1
};

test('Round 16 parameters are locked to requested values', () => {
  assert.deepEqual(ROUND16, {
    round: 16, evaluationIntervalMs: 30000, riskMax: 0.70,
    volatilityRatioMax: 1.50, weakAdxMin: 22, rangeAtrRatioMax: 1.25
  });
});

test('missing simulation forces CALL candidate to STANDBY', () => {
  const out = applySafetyGate(candidate, { ready: false, status: 'NOT_CONFIGURED' }, 60000);
  assert.equal(out.signal, 'STANDBY');
  assert.equal(out.safetyGate.status, 'SIMULATION_NOT_READY');
});

test('valid simulation passes all Round 16 gates', () => {
  const out = applySafetyGate(candidate, simulation, 60000);
  assert.equal(out.signal, 'CALL');
  assert.equal(out.safetyGate.passed, true);
});

test('simulation candle mismatch blocks directional output', () => {
  const out = applySafetyGate(candidate, { ...simulation, candleTime: 120000 }, 60000);
  assert.equal(out.signal, 'STANDBY');
  assert.equal(out.safetyGate.status, 'CANDLE_MISMATCH');
});

test('simulation direction mismatch blocks directional output', () => {
  const out = applySafetyGate(candidate, { ...simulation, signal: 'PUT' }, 60000);
  assert.equal(out.signal, 'STANDBY');
  assert.equal(out.safetyGate.status, 'DIRECTION_MISMATCH');
});

test('each Round 16 threshold blocks excessive risk, volatility and range or weak ADX', () => {
  for (const patch of [
    { riskScore: 0.71 }, { volatilityRatio: 1.51 },
    { adx: 21.99 }, { rangeAtrRatio: 1.26 }
  ]) {
    const out = applySafetyGate(candidate, { ...simulation, ...patch }, 60000);
    assert.equal(out.signal, 'STANDBY');
    assert.equal(out.safetyGate.status, 'PARAMETER_BLOCKED');
  }
});

test('live adapter fails closed while no simulation provider is connected', () => {
  const candles = Array.from({ length: 200 }, (_, i) => {
    const close = 1.1 + i * 0.00001;
    return { time: i * 60000, open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close };
  });
  const out = analyzeMainMarket(candles);
  assert.equal(out.signal, 'STANDBY');
  assert.equal(out.simulation.ready, false);
  assert.equal(out.signal, 'STANDBY');
});
