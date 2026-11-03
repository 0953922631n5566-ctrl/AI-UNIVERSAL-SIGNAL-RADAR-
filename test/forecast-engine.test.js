const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula } = require('../forecast-engine');

function candlesFrom(closes) {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString().slice(0, 19).replace('T', ' '),
    open: close, high: close, low: close, close
  }));
}

test('EMA uses the requested recursive smoothing formula', () => {
  assert.ok(Math.abs(calculateEMA([1, 2, 3, 4, 5], 5) - 3.3950617283950617) < 1e-12);
});

test('Bollinger Bandwidth is calculated from the last 20 prices', () => {
  const flat = Array(20).fill(1.1);
  assert.equal(calculateBB(flat).bandwidth, 0);
  assert.ok(calculateBB(Array.from({length:20},(_,i)=>1.1+i*0.0001)).bandwidth > 0);
});

test('RSI returns 100 when there are gains and no losses, as in supplied formula', () => {
  assert.equal(calculateRSI(Array.from({length:16},(_,i)=>1+i*0.001)), 100);
});

test('less than 20 real closed candles never produces a directional signal', () => {
  const result = evaluateLiveFormula(candlesFrom(Array.from({length:19},(_,i)=>1+i*0.0001)), 1.002, 1.001, Date.UTC(2026,0,1,0,0,59,500));
  assert.equal(result.ready, false);
  assert.equal(result.signal, 'WAIT');
});

test('strong rising prices follow the trend and qualify for CALL only in final 3 seconds', () => {
  const closes = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)+0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,57,500));
  assert.equal(result.isBullishTrend, true);
  assert.equal(result.candidate, 'CALL');
  assert.equal(result.exactTimeLeft, 2.5);
  assert.equal(result.confidence, '95.0');
});

test('strong falling prices follow the trend and qualify for PUT only in final 3 seconds', () => {
  const closes = Array.from({length:80},(_,i)=>1.2-i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)-0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,58,0));
  assert.equal(result.isBearishTrend, true);
  assert.equal(result.candidate, 'PUT');
  assert.equal(result.exactTimeLeft, 2);
});

test('flat prices are SIDEWAY/DANGER and cannot create CALL or PUT', () => {
  const closes = Array(80).fill(1.1);
  const result = evaluateLiveFormula(candlesFrom(closes), 1.1, 1.1, Date.UTC(2026,0,1,0,0,58,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.statusText, 'DANGER');
  assert.equal(result.candidate, 'WAIT');
});

test('trend is not considered valid when current price has not confirmed EMA5', () => {
  const closes = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)-0.01, closes.at(-1), Date.UTC(2026,0,1,0,0,58,0));
  assert.equal(result.isBullishTrend, false);
  assert.notEqual(result.candidate, 'CALL');
});
