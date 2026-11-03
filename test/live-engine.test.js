const test = require('node:test');
const assert = require('node:assert/strict');
const { createMinuteCandleAggregator, gateForecastWithLiveCandle } = require('../live-engine');

const base = Date.UTC(2026, 0, 1, 0, 0, 0);

test('aggregates multiple fresh quote ticks into one completed M1 candle',()=>{
  const a=createMinuteCandleAggregator();
  a.ingest(1.1000,base);
  a.ingest(1.1005,base+20000);
  a.ingest(1.1003,base+55000);
  const done=a.ingest(1.1004,base+60000);
  assert.equal(done.datetime,'2026-01-01 00:00:00');
  assert.equal(done.open,1.1000);
  assert.equal(done.high,1.1005);
  assert.equal(done.low,1.1000);
  assert.equal(done.close,1.1003);
});

test('uses the next minute boundary quote as close when only one tick arrived',()=>{
  const a=createMinuteCandleAggregator();
  a.ingest(1.1000,base);
  const done=a.ingest(1.1002,base+60000);
  assert.equal(done.open,1.1000);
  assert.equal(done.close,1.1002);
  assert.equal(done.high,1.1002);
  assert.equal(done.low,1.1000);
});

test('does not invent missing candles when the live stream has a minute gap',()=>{
  const a=createMinuteCandleAggregator();
  a.ingest(1.1000,base);
  assert.equal(a.ingest(1.1010,base+120000),null);
  assert.equal(a.getCompletedCandles().length,0);
});

test('ignores out-of-order ticks within a minute',()=>{
  const a=createMinuteCandleAggregator();
  a.ingest(1.1000,base);
  a.ingest(1.1005,base+30000);
  a.ingest(1.0990,base+15000);
  const done=a.ingest(1.1004,base+60000);
  assert.equal(done.close,1.1005);
});

test('exposes the forming live candle direction without marking it complete',()=>{
  const a=createMinuteCandleAggregator();
  a.ingest(1.1000,base);
  a.ingest(1.1004,base+30000);
  const current=a.getCurrentCandle();
  assert.equal(current.ticks,2);
  assert.equal(current.direction,'BULLISH');
  assert.equal(current.close,1.1004);
  assert.equal(a.getCompletedCandles().length,0);
});
