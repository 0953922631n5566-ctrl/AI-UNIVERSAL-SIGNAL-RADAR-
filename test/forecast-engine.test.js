const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula } = require('../forecast-engine');

function candlesFrom(closes, spread = 0) {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString().slice(0, 19).replace('T', ' '),
    open: close, high: close + spread, low: close - spread, close
  }));
}

test('EMA uses an SMA seed followed by recursive smoothing', () => {
  assert.equal(calculateEMA([1, 2, 3, 4, 5], 5), 3);
  assert.equal(calculateEMA([1, 2, 3, 4, 5, 6], 5), 4);
});

test('Bollinger Bandwidth is calculated from the last 20 prices', () => {
  assert.equal(calculateBB(Array(20).fill(1.1)).bandwidth, 0);
  assert.ok(calculateBB(Array.from({length:20},(_,i)=>1.1+i*0.0001)).bandwidth > 0);
});

test('Wilder RSI returns 100 on uninterrupted gains, 0 on losses, and 50 when flat', () => {
  assert.equal(calculateRSI(Array.from({length:30},(_,i)=>1+i*0.001)), 100);
  assert.equal(calculateRSI(Array.from({length:30},(_,i)=>1-i*0.001)), 0);
  assert.equal(calculateRSI(Array(30).fill(1.1)), 50);
});

test('signal strictness defaults to 64% and modestly adjusts RSI confirmation only', () => {
  const { SIGNAL_STRICTNESS, RSI_CONFIRMATION_LEVEL } = require('../forecast-engine');
  assert.equal(SIGNAL_STRICTNESS, 64);
  assert.equal(Number(RSI_CONFIRMATION_LEVEL.toFixed(2)), 51.35);
});

test('less than 20 real closed candles never produces a directional signal', () => {
  const result = evaluateLiveFormula(candlesFrom(Array.from({length:19},(_,i)=>1+i*0.0001)), 1.002, 1.001, Date.UTC(2026,0,1,0,0,54,500));
  assert.equal(result.ready, false);
  assert.equal(result.candidate, 'WAIT');
});

test('strong rising market creates a CALL candidate only with aligned EMA and RSI', () => {
  const closes = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)+0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,55,500));
  assert.equal(result.candidate, 'CALL');
  assert.equal(result.breakoutUp, true);
  assert.equal(result.rsiBullish, true);
  assert.equal(result.exactTimeLeft, 4.5);
});

test('strong falling market creates a PUT candidate only with aligned EMA and RSI', () => {
  const closes = Array.from({length:80},(_,i)=>1.2-i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(closes), closes.at(-1)-0.0001, closes.at(-1), Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.candidate, 'PUT');
  assert.equal(result.breakoutDown, true);
  assert.equal(result.rsiBearish, true);
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

test('a narrow range does not signal until RSI confirms a range-edge rejection', () => {
  const closes = Array.from({length:80},(_,i)=>1.1 + (i%8===0 ? 0.00001 : 0));
  const result = evaluateLiveFormula(candlesFrom(closes, 0.00001), 1.1, 1.1, Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.candidate, 'WAIT');
});

test('sideway support bounce remains a limited, RSI-confirmed exception', () => {
  const candles = candlesFrom(Array(80).fill(1.1), 0.00001);
  const result = evaluateLiveFormula(candles, 1.09999, 1.1, Date.UTC(2026,0,1,0,0,56,0));
  assert.equal(result.isSideway, true);
  assert.equal(result.sidewaySupportBounce, true);
  assert.equal(result.candidate, 'CALL');
});


test('manual UPTREND mode follows rising trend but refuses the opposite trend', () => {
  const rising = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const risingResult = evaluateLiveFormula(candlesFrom(rising), rising.at(-1)+0.0001, rising.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'uptrend', strictness:55 });
  assert.equal(risingResult.mode, 'uptrend');
  assert.equal(risingResult.candidate, 'CALL');
  const falling = Array.from({length:80},(_,i)=>1.2-i*0.0002);
  const fallingResult = evaluateLiveFormula(candlesFrom(falling), falling.at(-1)-0.0001, falling.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'uptrend', strictness:55 });
  assert.equal(fallingResult.candidate, 'WAIT');
});

test('manual DOWNTREND mode refuses an upward trend', () => {
  const rising = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(rising), rising.at(-1)+0.0001, rising.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'downtrend', strictness:55 });
  assert.equal(result.candidate, 'WAIT');
});

test('manual SIDEWAY mode does not trade a trending market', () => {
  const rising = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const result = evaluateLiveFormula(candlesFrom(rising), rising.at(-1)+0.0001, rising.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'sideway', strictness:55 });
  assert.equal(result.candidate, 'WAIT');
  assert.match(result.regime, /SIDEWAY MODE/);
});

test('strictness is clamped to 55-100 and raises RSI confirmation', () => {
  const prices = Array.from({length:80},(_,i)=>1.08+i*0.0002);
  const low = evaluateLiveFormula(candlesFrom(prices), prices.at(-1)+0.0001, prices.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'auto', strictness:55 });
  const high = evaluateLiveFormula(candlesFrom(prices), prices.at(-1)+0.0001, prices.at(-1), Date.UTC(2026,0,1,0,0,55,500), { mode:'auto', strictness:100 });
  assert.equal(low.strictness, 55);
  assert.equal(low.rsiConfirmationLevel, 50);
  assert.equal(high.strictness, 100);
  assert.equal(high.rsiConfirmationLevel, 56.75);
});
