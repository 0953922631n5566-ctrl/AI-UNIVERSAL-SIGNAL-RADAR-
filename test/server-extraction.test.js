const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server');

test.beforeEach(() => engine._resetForTests());

test('extracts one unambiguous decimal quote from raw OCR', () => {
  assert.equal(engine.extractPrice('EUR/USD\n1.08456'), 1.08456);
});

test('rejects ambiguous multiple OCR prices instead of guessing', () => {
  assert.equal(engine.extractPrice('EUR/USD\n1.08456\n1.08460'), null);
});

test('rejects integer-only or missing OCR price', () => {
  assert.equal(engine.extractPrice('EUR/USD\n108456'), null);
  assert.equal(engine.extractPrice('chart only'), null);
});

test('requires six completed M1 candles before indicator analysis', () => {
  const base = 1_800_000_000_000;
  let result;
  for (let i = 0; i <= 5; i++) {
    const timestamp = base + i * 60_000;
    result = engine.ingestPrice({
      symbol: 'EUR/USD', market: 'OTC',
      rawText: 'EUR/USD\\n' + (1.08000 + i * 0.00010).toFixed(5),
      timestamp
    }, timestamp);
  }
  assert.equal(result.status, 'STANDBY');
  assert.equal(result.closedCandles, 5);
  const timestamp = base + 6 * 60_000;
  result = engine.ingestPrice({
    symbol: 'EUR/USD', market: 'OTC',
    rawText: 'EUR/USD\\n1.08060', timestamp
  }, timestamp);
  assert.equal(result.accepted, true);
  assert.equal(result.closedCandles, 6);
  assert.ok(result.indicators);
  assert.ok(Number.isFinite(result.indicators.ema3));
  assert.ok(Number.isFinite(result.indicators.ema5));
  assert.ok(Number.isFinite(result.indicators.rsi5));
  assert.ok(Number.isFinite(result.indicators.macd.histogram));
});

test('resets M1 history on a missing minute and returns STANDBY', () => {
  const base = 1_800_000_000_000;
  engine.ingestPrice({symbol:'EUR/USD',market:'OTC',rawText:'EUR/USD\\n1.08000',timestamp:base},base);
  const next = base + 2 * 60_000;
  const result = engine.ingestPrice({symbol:'EUR/USD',market:'OTC',rawText:'EUR/USD\\n1.08020',timestamp:next},next);
  assert.equal(result.status, 'STANDBY');
  assert.equal(result.reason, 'M1_DATA_GAP_RESET');
  assert.equal(result.closedCandles, 0);
});

test('rejects stale and duplicate timestamps', () => {
  const base = 1_800_000_000_000;
  const input = {symbol:'EUR/USD',market:'OTC',rawText:'EUR/USD\\n1.08000',timestamp:base};
  assert.equal(engine.ingestPrice(input, base + 100_000).reason, 'STALE_OCR_DATA');
  assert.equal(engine.ingestPrice(input, base).accepted, true);
  assert.equal(engine.ingestPrice(input, base).reason, 'DUPLICATE_OR_OLD_TICK');
});
