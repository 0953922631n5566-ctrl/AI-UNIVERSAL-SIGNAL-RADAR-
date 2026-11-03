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

const nextMinute=Date.UTC(2026,0,1,0,1,0);
const nextIso=new Date(nextMinute).toISOString();
const liveBar=(direction,ticks=2)=>({datetime:'2026-01-01 00:01:00',direction,ticks});

test('keeps CALL only when the current live M1 candle is bullish and fresh',()=>{
  const forecast={signal:'CALL',nextCandleAt:nextIso,reason:'base'};
  const r=gateForecastWithLiveCandle(forecast,liveBar('BULLISH'),nextMinute+2000);
  assert.equal(r.signal,'CALL');
});

test('forces STANDBY when current live candle opposes the forecast',()=>{
  const forecast={signal:'PUT',nextCandleAt:nextIso,reason:'base'};
  const r=gateForecastWithLiveCandle(forecast,liveBar('BULLISH'),nextMinute+2000);
  assert.equal(r.signal,'STANDBY');
  assert.match(r.reason,/สวนกับสัญญาณ/);
});

test('forces STANDBY when the forecast targets an old M1 minute',()=>{
  const forecast={signal:'PUT',nextCandleAt:new Date(nextMinute-60000).toISOString(),reason:'base'};
  const r=gateForecastWithLiveCandle(forecast,liveBar('BEARISH'),nextMinute+2000);
  assert.equal(r.signal,'STANDBY');
});

test('waits for at least two live ticks before showing a direction',()=>{
  const forecast={signal:'CALL',nextCandleAt:nextIso,reason:'base'};
  const r=gateForecastWithLiveCandle(forecast,liveBar('BULLISH',1),nextMinute+2000);
  assert.equal(r.signal,'STANDBY');
});
