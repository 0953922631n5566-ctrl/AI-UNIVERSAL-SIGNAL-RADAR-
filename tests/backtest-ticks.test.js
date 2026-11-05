'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTicks, buildM1Candles, runTickBacktest, bucket, splitRowsChronologically, evaluateFilter } = require('../scripts/backtest-ticks');

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
  const ticks = loadTicks(histTicks(12060));
  const report = runTickBacktest(ticks, { thresholds: [0.6], horizons: [10, 20, 30] });
  assert.deepEqual(report.evaluatedHorizonsSeconds, [10, 20, 30]);
  assert.deepEqual(Object.keys(report.reports), ['10', '20', '30']);
});

 
test('optimizer reports feature attribution and enforces good-signal-loss cap', () => {
  const { optimizeFilter } = require('../scripts/backtest-ticks');
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({
    risk: 0.48, volatilityRatio: 1.9, adx: 14, rangeAtr: 1.8,
    fakeout: true, good: false
  });
  for (let i = 0; i < 30; i++) rows.push({
    risk: 0.35, volatilityRatio: 1.0, adx: 28, rangeAtr: 0.8,
    fakeout: false, good: true
  });
  const result = optimizeFilter(rows, {
    riskThresholds: [0.45, 0.55],
    volatilityThresholds: [1.5],
    weakAdxThresholds: [18],
    rangeAtrThresholds: [1.5],
    maxGoodSignalLossPct: 10,
    minSamples: 50
  });
  assert.equal(result.candidatesEvaluated, 2);
  assert.ok(result.best.length > 0);
  assert.equal(result.best[0].fakeoutCapturePct, 100);
  assert.equal(result.best[0].goodSignalLossPct, 0);
});


test('attribution buckets are mutually exclusive with exact inclusive boundaries', () => {
  const edges = [1, 1.5, 2];
  assert.equal(bucket(1, edges), '<=1');
  assert.equal(bucket(1.01, edges), '(1,1.5]');
  assert.equal(bucket(1.5, edges), '(1,1.5]');
  assert.equal(bucket(1.5001, edges), '(1.5,2]');
  assert.equal(bucket(2, edges), '(1.5,2]');
  assert.equal(bucket(2.01, edges), '>2');
  assert.equal(bucket('TRENDING', edges), 'TRENDING');
  assert.equal(bucket(NaN, edges), 'UNKNOWN');
});

test('chronological split keeps UTC dates disjoint and trains only on earlier dates', () => {
  const rows = [];
  for (let day = 1; day <= 4; day++) {
    rows.push({ time: Date.parse(`2026-10-0${day}T12:00:00Z`), fakeout: day > 2, good: day <= 2 });
  }
  const split = splitRowsChronologically(rows);
  assert.deepEqual(split.trainDates, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(split.testDates, ['2026-10-03', '2026-10-04']);
  assert.equal(split.train.length, 2);
  assert.equal(split.test.length, 2);
  assert.ok(Math.max(...split.train.map(x => x.time)) < Math.min(...split.test.map(x => x.time)));
});

test('out-of-sample evaluation applies frozen parameters without re-optimization', () => {
  const params = { riskThreshold: 0.5, volatilityThreshold: 1.5, weakAdxMax: 20, rangeAtrThreshold: 1.5 };
  const holdout = [
    { risk: 0.6, volatilityRatio: 1, adx: 30, rangeAtr: 1, fakeout: true, good: false },
    { risk: 0.2, volatilityRatio: 1, adx: 30, rangeAtr: 1, fakeout: false, good: true }
  ];
  const result = evaluateFilter(holdout, params);
  assert.equal(result.samples, 2);
  assert.equal(result.fakeoutCapturePct, 100);
  assert.equal(result.goodSignalLossPct, 0);
});
