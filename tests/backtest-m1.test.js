'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCandles, runM1Backtest } = require('../scripts/backtest-m1');

function csv(count = 205) {
  const lines = ['datetime,open,high,low,close'];
  for (let i = 0; i < count; i++) {
    const close = 1.1 + i * 0.00001;
    lines.push(`${new Date(i * 60000).toISOString()},${close - 0.00001},${close + 0.00002},${close - 0.00002},${close}`);
  }
  return lines.join('\\n');
}

test('CSV loader parses chronological OHLC candles', () => {
  const rows = loadCandles(csv());
  assert.equal(rows.length, 205);
  assert.equal(rows[0].time, 0);
});

test('CSV loader rejects non-ascending timestamps', () => {
  const source = 'time,open,high,low,close\\n2025-01-01T00:01:00Z,1,2,0,1\\n2025-01-01T00:00:00Z,1,2,0,1';
  assert.throws(() => loadCandles(source), /strictly ascending/);
});

test('M1 replay labels itself as next-candle diagnostic and reports threshold grid', () => {
  const report = runM1Backtest(loadCandles(csv()), [0.6, 0.72]);
  assert.equal(report.mode, 'M1_NEXT_CANDLE_RANGE_DIAGNOSTIC');
  assert.equal(report.thresholds.length, 2);
  assert.match(report.warning, /does not validate 10\\/20\\/30-second/);
});
