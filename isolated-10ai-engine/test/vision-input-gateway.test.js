'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVisionAnalyzeHandler, decodeBase64Image } = require('../src/vision-input-gateway');

function fixture() {
  const start = Math.floor(Date.now() / 60000) * 60 - 200 * 60;
  const candles = Array.from({ length: 200 }, (_, n) => ({
    epoch: start + n * 60, open: 1.1, high: 1.1001, low: 1.0999, close: 1.10002, volume: 100
  }));
  return { candles, indicators: { rsi: 50, adx: 20 }, regime: 'UPTREND', tickAgeSeconds: 2 };
}
function mockRequest(body, contentType, method = 'POST') {
  return {
    url: '/api/v1/vision/analyze-chart', method, headers: { 'content-type': contentType },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  };
}
function mockResponse() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
}

test('Base64 image decoder accepts supported image MIME and rejects unsupported types', () => {
  const image = decodeBase64Image(Buffer.from('fake-jpeg').toString('base64'), 'image/jpeg');
  assert.equal(image.mimeType, 'image/jpeg');
  assert.throws(() => decodeBase64Image(Buffer.from('x').toString('base64'), 'text/plain'), /Only JPEG/);
});

test('JSON Base64 image is passed through injected vision adapter and dispatched to AI-10', async () => {
  let adapterCalled = false, analyzeCalled = false;
  const marketData = fixture();
  const handler = createVisionAnalyzeHandler({
    visionAdapter: async (image, chartContext) => {
      adapterCalled = true;
      assert.equal(image.mimeType, 'image/png');
      assert.equal(chartContext.symbol, 'EUR/USD');
      return { marketData, marketContext: marketData };
    },
    analyze: async (data, context) => {
      analyzeCalled = true;
      assert.equal(data.candles.length, 200);
      assert.equal(context.regime, 'UPTREND');
      return { signal: 'STANDBY', engineResults: Array(10).fill({ direction: 'NO_SIGNAL' }) };
    }
  });
  const req = mockRequest(JSON.stringify({
    imageBase64: 'data:image/png;base64,' + Buffer.from('chart').toString('base64'),
    chartContext: { symbol: 'EUR/USD', timeframe: 'M1' }
  }), 'application/json');
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(adapterCalled, true);
  assert.equal(analyzeCalled, true);
  assert.equal(JSON.parse(res.body).source, 'vision_adapter');
});

test('image-only request returns 503 when no vision adapter is configured', async () => {
  const handler = createVisionAnalyzeHandler({ analyze: async () => ({ signal: 'STANDBY' }) });
  const req = mockRequest(JSON.stringify({ imageBase64: Buffer.from('chart').toString('base64') }), 'application/json');
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
});

test('gateway rejects missing 200-candle context instead of inventing OHLC data', async () => {
  const handler = createVisionAnalyzeHandler({
    visionAdapter: async () => ({ marketData: { candles: [] }, marketContext: { regime: 'UNCLEAR', indicators: {} } }),
    analyze: async () => ({ signal: 'CALL' })
  });
  const req = mockRequest(JSON.stringify({ imageBase64: Buffer.from('chart').toString('base64') }), 'application/json');
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 422);
  assert.match(JSON.parse(res.body).error, /200 OHLC candles/);
});

test('gateway only exposes POST on the exact vision route', async () => {
  const handler = createVisionAnalyzeHandler({ analyze: async () => ({}) });
  const req = mockRequest('{}', 'application/json', 'GET');
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('multipart screenshot and chartContext JSON are accepted', async () => {
  const boundary = 'RadarBoundaryAa91';
  const marketData = fixture();
  let called = false;
  const handler = createVisionAnalyzeHandler({
    visionAdapter: async (image, context) => {
      called = true;
      assert.equal(image.mimeType, 'image/jpeg');
      assert.equal(context.symbol, 'EUR/USD');
      return { marketData, marketContext: marketData };
    },
    analyze: async () => ({ signal: 'STANDBY' })
  });
  const body = [
    '--' + boundary,
    'Content-Disposition: form-data; name="chartContext"',
    'Content-Type: application/json',
    '',
    JSON.stringify({ symbol: 'EUR/USD', timeframe: 'M1' }),
    '--' + boundary,
    'Content-Disposition: form-data; name="image"; filename="chart.jpg"',
    'Content-Type: image/jpeg',
    '',
    'fake-jpeg-binary',
    '--' + boundary + '--',
    ''
  ].join('\r\n');
  const req = mockRequest(body, 'multipart/form-data; boundary=' + boundary);
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(called, true);
});
