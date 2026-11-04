'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTicks, buildM1Candles, runTickBacktest } = require('../scripts/backtest-ticks');

function histTicks(count = 120) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const time = new Date(0 + i * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const stamp = `${time.slice(0, 8)} ${time.slice(8)}`;
    const mid = 1.1 + i * 0.000001;
    rows.push(`${stamp};${(mid - 0.00005).toFixed(6)};${(mid + 0.00005).toFixed(6)}`);
  }
  return rows.join('\n');
}

test('loads HistData Generic ASCII bid/ask ticks with fixed EST timestamps', () => {
  const ticks = loadTicks(histTicks());
  assert.equal(ticks.length, 120);
  assert.equal(ticks[0].time, Date.parse('1970-01-01T05:00:00Z'));
  assert.ok(ticks[0].ask > ticks[0].bid);
});

test('rejects crossed quotes and descending tick timestamps', () => {
  const crossed = 'time;bid;ask\n2025-01-01T00:00:00Z;1.2;1.1';
  assert.throws(() => loadTicks(crossed), /Invalid bid\/ask/);
  const descending = 'time;bid;ask\n2025-01-01T00:00:02Z;1;1.1\n2025-01-01T00:00:01Z;1;1.1';
  assert.throws(() => loadTicks(descending), /non-decreasing/);
});

test('aggregates bid/ask into M1 mid-price candles', () => {
  const ticks = loadTicks(histTicks(120));
  const candles = buildM1Candles(ticks);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].tickCount, 60);
  assert.ok(candles[0].high >= candles[0].low);
});

test('tick replay returns separate 10/20/30 second report buckets', () => {
  const ticks = loadTicks(histTicks(120));
  const report = runTickBacktest(ticks, { thresholds: [0.6], horizons: [10, 20, 30] });
  assert.deepEqual(report.evaluatedHorizonsSeconds, [10, 20, 30]);
  assert.deepEqual(Object.keys(report.reports), ['10', '20', '30']);
});
