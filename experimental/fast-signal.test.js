'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFastSignal, backtestFastSignal } = require('./fast-signal');

function risingCandles(n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const open = 1.10000 + i * 0.00012;
    const close = open + 0.00008;
    return { datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      open, high: close + 0.00003, low: open - 0.00002, close };
  });
}
function fallingCandles(n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const open = 1.11000 - i * 0.00012;
    const close = open - 0.00008;
    return { datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      open, high: open + 0.00002, low: close - 0.00003, close };
  });
}

test('requires warm-up and safely returns STANDBY', () => {
  const result = analyzeFastSignal(risingCandles(10));
  assert.equal(result.signal, 'STANDBY');
  assert.equal(result.requiredCandles, 25);
});

test('strong rising market can produce CALL', () => {
  const result = analyzeFastSignal(risingCandles());
  assert.equal(result.signal, 'CALL');
  assert.ok(result.callScore >= 55);
});

test('strong falling market can produce PUT', () => {
  const result = analyzeFastSignal(fallingCandles());
  assert.equal(result.signal, 'PUT');
  assert.ok(result.putScore >= 55);
});

test('rejects duplicate or out-of-order candle timestamps', () => {
  const data = risingCandles();
  data[10].datetime = data[9].datetime;
  assert.throws(() => analyzeFastSignal(data), /strictly chronological/);
});

test('backtest uses only the next candle as outcome and returns counters', () => {
  const data = risingCandles(45);
  const result = backtestFastSignal(data);
  assert.ok(result.signals > 0);
  assert.equal(result.wins + result.losses + result.flats, result.signals);
  assert.equal(result.outcomes[0].entry, data[25].open);
  assert.equal(result.outcomes[0].exit, data[25].close);
});
