const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula } = require('../forecast-engine');

function candlesFrom(closes, spread = 0) {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString().slice(0, 19).replace('T', ' '),
    open: close, high: close + spread, low: close - spread, close
  }));
}

test('EMA uses recursive smoothing', () => {
  assert.ok(Math.abs(calculateEMA([1, 2, 3, 4, 5], 5) - 3.3950617283950617) < 1e-12);
});

test('Bollinger Bandwidth is calculated from the last 20 prices', () => {
  assert.equal(calculateBB(Array(20).fill(1.1)).bandwidth, 0);
  assert.ok(calculateBB(Array.from({length:20},(_,i)=>1.1+i*0.0001)).bandwidth > 0);
});

test('RSI returns 100 when gains have no losses', () => {
  assert.equal(calculateRSI(Array.from({length:16},(_,i)=>1+i*0.001)), 100);
});

test('less than 20 real closed candles never produces a directional signal', () => {
  const result = evaluateLiveFormula(candlesFrom(Array.from({length:19},(_,i)=>1+i*0.0001)), 1.002, 1.001, Date.UTC(2026,0,1,0,0,54,500));
  assert.equal(result.ready, false);
  assert.equal(result.candidate, 'WAIT');
});

test('strong rising market creates a CALL candidate in the final five-second window', () => {
  const closes = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)+0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,55,500));
  assert.equal(result.candidate, 'CALL');
  assert.equal(result.breakoutUp, true);
  assert.equal(result.exactTimeLeft, 4.5);
});

test('strong falling market creates a PUT candidate in the final five-second window', () => {
  const closes = Array.from({length:80},(_,i)=>1.2-i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)-0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.candidate, 'PUT');
  assert.equal(result.breakoutDown, true);
  assert.equal(result.exactTimeLeft, 4);
});

test('flat narrow prices stay STANDBY instead of inventing a direction', () => {
  const result = evaluateLiveFormula(candlesFrom(Array(80).fill(1.1)), 1.1, 1.1, Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.statusText, 'DANGER');
  assert.equal(result.candidate, 'WAIT');
});

test('trend-following entry does not take a counter-trend price', () => {
  const closes = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)-0.01, closes.at(-1), Date.UTC(2026,0,1,0,0,56,0));
  assert.notEqual(result.candidate, 'CALL');
});

test('a low-bandwidth range can produce a CALL only at confirmed support with RSI', () => {
  const closes = Array.from({length:80},(_,i)=>1.1 + (i%8===0 ? 0.00001 : 0));
  const candles = candlesFrom(closes, 0.00001);
  const result = evaluateLiveFormula(candles, 1.1, 1.1, Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.candidate, 'WAIT'); // neutral RSI is not sufficient confirmation
});

test('sideway support bounce needs a low RSI confirmation', () => {
  const candles = candlesFrom(Array(80).fill(1.1), 0.00001);
  const result = evaluateLiveFormula(candles, 1.09999, 1.1, Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.sidewaySupportBounce, true);
  assert.equal(result.candidate, 'CALL');
});
