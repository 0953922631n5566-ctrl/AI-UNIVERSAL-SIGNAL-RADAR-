'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCandles, runM1Backtest, HISTORY_WINDOW_CANDLES } = require('../scripts/backtest-m1');

function csv(count = 205) {
  const lines = ['datetime,open,high,low,close'];
  for (let i = 0; i < count; i++) {
    const close = 1.1 + i * 0.00001;
    lines.push(`${new Date(i * 60000).toISOString()},${close - 0.00001},${close + 0.00002},${close - 0.00002},${close}`);
  }
  return lines.join('\n');
}

test('CSV loader parses chronological OHLC candles', () => {
  const rows = loadCandles(csv());
  assert.equal(rows.length, 205);
  assert.equal(rows[0].time, 0);
});

test('CSV loader rejects non-ascending timestamps', () => {
  const source = 'time,open,high,low,close\n2025-01-01T00:01:00Z,1,2,0,1\n2025-01-01T00:00:00Z,1,2,0,1';
  assert.throws(() => loadCandles(source), /strictly ascending/);
});

test('CSV loader supports HistData Generic ASCII semicolon rows and fixed EST', () => {
  const lines = [];
  for (let i = 0; i < 205; i++) {
    const d = new Date(i * 60000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const stamp = `${d.slice(0, 8)} ${d.slice(8)}`;
    const close = 1.1 + i * 0.00001;
    lines.push(`${stamp};${close - 0.00001};${close + 0.00002};${close - 0.00002};${close};0`);
  }
  const rows = loadCandles(lines.join('\n'));
  assert.equal(rows.length, 205);
  assert.equal(rows[0].time, Date.parse('1970-01-01T05:00:00Z'));
});

test('M1 replay labels itself as next-candle diagnostic and reports threshold grid', () => {
  const report = runM1Backtest(loadCandles(csv()), [0.6, 0.72]);
  assert.equal(report.mode, 'M1_NEXT_CANDLE_RANGE_DIAGNOSTIC');
  assert.equal(report.thresholds.length, 2);
  assert.match(report.warning, /does not validate 10\/20\/30-second/);
});

test('M1 diagnostic uses a bounded 200-candle feature window',()=>{
 const report=runM1Backtest(loadCandles(csv(230)),[0.6]);
 assert.equal(HISTORY_WINDOW_CANDLES,200);
 assert.equal(report.featureWindowCandles,200);
});
