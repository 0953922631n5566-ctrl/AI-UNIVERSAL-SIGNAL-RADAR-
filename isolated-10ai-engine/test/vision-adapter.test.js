'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExtraction, VisionExtractionError, createOpenAIVisionAdapter } = require('../src/vision-adapter');

function goodExtraction() {
  const start = 1700000000;
  return {
    readable: true, rejectionReason: '', symbol: 'EUR/USD', timeframe: 'M1',
    overallConfidence: 0.995, regime: 'UPTREND', trendDirection: 'BULLISH',
    marketStructure: 'Higher highs and higher lows', candlestickPatterns: ['bullish_engulfing'],
    visibleIndicators: { rsi: 55, adx: 24, plusDI: 28, minusDI: 14, macdHistogram: 0.0001,
      ema9: 1.1, ema21: 1.099, ema50: 1.098, volatilityRatio: 1.1 },
    nearSupport: false, nearResistance: false,
    candles: Array.from({ length: 200 }, (_, i) => ({
      epoch: start + i * 60, open: 1.1, high: 1.1002, low: 1.0998, close: 1.1001, confidence: 0.995
    }))
  };
}
const fresh = { symbol: 'EUR/USD', timeframe: 'M1', tickAgeSeconds: 3 };

test('strictly accepts 200 valid, high-confidence candles with trusted freshness metadata', () => {
  assert.equal(validateExtraction(goodExtraction(), fresh).candles.length, 200);
});
test('rejects unreadable screenshots and low-confidence candle values', () => {
  const unreadable = goodExtraction(); unreadable.readable = false; unreadable.rejectionReason = 'blurred';
  assert.throws(() => validateExtraction(unreadable, fresh), e => e instanceof VisionExtractionError && e.code === 'CHART_UNREADABLE');
  const weak = goodExtraction(); weak.candles[40].confidence = 0.7;
  assert.throws(() => validateExtraction(weak, fresh), e => e.code === 'CANDLE_UNREADABLE');
});
test('rejects missing candles, missing trusted freshness and invalid OHLC', () => {
  const few = goodExtraction(); few.candles.pop();
  assert.throws(() => validateExtraction(few, fresh), e => e.code === 'INSUFFICIENT_CANDLES');
  assert.throws(() => validateExtraction(goodExtraction(), { symbol: 'EUR/USD', timeframe: 'M1' }), e => e.code === 'FRESHNESS_UNVERIFIED');
  const bad = goodExtraction(); bad.candles[2].high = 1.0;
  assert.throws(() => validateExtraction(bad, fresh), e => e.code === 'INVALID_OHLC');
});
test('OpenAI adapter refuses to call provider without an API key', async () => {
  const adapter = createOpenAIVisionAdapter({ apiKey: '' });
  await assert.rejects(() => adapter({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' }, fresh),
    e => e instanceof VisionExtractionError && e.status === 503);
});
test('OpenAI adapter parses strict model response and returns AI-10 market payload', async () => {
  const extraction = goodExtraction();
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4o');
    assert.equal(body.temperature, 0);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(extraction) } }] }) };
  };
  const adapter = createOpenAIVisionAdapter({ apiKey: 'test-key', fetchImpl });
  const result = await adapter({ buffer: Buffer.from('image'), mimeType: 'image/png' }, fresh);
  assert.equal(result.marketData.candles.length, 200);
  assert.equal(result.marketContext.visual.source, 'openai-gpt-4o-vision');
});
