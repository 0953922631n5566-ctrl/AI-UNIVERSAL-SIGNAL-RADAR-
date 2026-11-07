'use strict';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function decodeBase64Image(value, mimeType = 'image/jpeg', maxBytes = DEFAULT_MAX_BYTES) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'imageBase64 is required');
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
  const encoded = match ? match[2] : value;
  const mime = (match ? match[1] : mimeType).toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new HttpError(415, 'Only JPEG, PNG and WebP images are accepted');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new HttpError(400, 'Invalid Base64 image payload');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw new HttpError(413, 'Image is empty or exceeds the upload limit');
  return { buffer, mimeType: mime };
}

async function readBody(req, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw new HttpError(413, 'Request body exceeds the upload limit');
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, contentType, maxBytes) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]).trim();
  if (!boundary) throw new HttpError(400, 'Multipart boundary is missing');
  const marker = Buffer.from('--' + boundary);
  const parts = {};
  let cursor = 0;
  while (true) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    let partStart = start + marker.length;
    if (buffer.subarray(partStart, partStart + 2).toString() === '--') break;
    if (buffer.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd < 0) break;
    const headers = buffer.subarray(partStart, headerEnd).toString('utf8');
    const next = buffer.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    let dataEnd = next;
    if (buffer.subarray(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    const disposition = headers.match(/content-disposition:\s*form-data;[^\r\n]*?name="([^"]+)"(?:;[^\r\n]*?filename="([^"]*)")?/i);
    if (disposition) {
      const name = disposition[1], filename = disposition[2];
      const data = buffer.subarray(headerEnd + 4, dataEnd);
      if (filename !== undefined || name === 'image') {
        const type = headers.match(/content-type:\s*([^\r\n]+)/i);
        parts.image = { buffer: Buffer.from(data), mimeType: (type?.[1] || 'application/octet-stream').trim().toLowerCase(), filename: filename || 'upload' };
      } else {
        parts[name] = data.toString('utf8');
      }
    }
    cursor = next;
  }
  if (parts.image && parts.image.buffer.length > maxBytes) throw new HttpError(413, 'Image exceeds the upload limit');
  return parts;
}

function parseContext(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try { return JSON.parse(value); }
  catch { throw new HttpError(400, 'chartContext must contain valid JSON'); }
}

function validateMarketInput(marketData, marketContext) {
  if (!marketData || !Array.isArray(marketData.candles) || marketData.candles.length < 200)
    throw new HttpError(422, 'Vision adapter must provide at least 200 OHLC candles for the Safety Noise Guard');
  if (!marketData.indicators || typeof marketData.indicators !== 'object')
    throw new HttpError(422, 'Vision adapter must provide calculated indicators');
  if (!marketContext || !marketContext.indicators || !marketContext.regime)
    throw new HttpError(422, 'Vision adapter must provide marketContext regime and indicators');
  for (const candle of marketData.candles.slice(-200)) {
    if (!candle || !['open', 'high', 'low', 'close'].every(k => Number.isFinite(candle[k])) ||
        candle.low <= 0 || candle.close <= 0 || candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close))
      throw new HttpError(422, 'Vision adapter returned invalid OHLC candle data');
  }
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/**
 * Creates a framework-neutral Node HTTP handler for POST /api/v1/vision/analyze-chart.
 * visionAdapter(image, chartContext) must return { marketData, marketContext }.
 * The adapter is injected deliberately: image pixels are never treated as trusted OHLC data.
 */
function createVisionAnalyzeHandler({ analyze, visionAdapter = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof analyze !== 'function') throw new TypeError('analyze function is required');
  return async function visionAnalyzeHandler(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/api/v1/vision/analyze-chart') return send(res, 404, { error: 'NOT_FOUND' });
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const raw = await readBody(req, Math.ceil(maxBytes * 1.5) + 64 * 1024);
      const contentType = String(req.headers['content-type'] || '');
      const type = contentType.toLowerCase();
      let image = null, input = {};
      if (type.includes('application/json')) {
        try { input = JSON.parse(raw.toString('utf8')); }
        catch { throw new HttpError(400, 'Request body must be valid JSON'); }
        if (input.imageBase64) image = decodeBase64Image(input.imageBase64, input.mimeType, maxBytes);
      } else if (type.includes('multipart/form-data')) {
        const parts = parseMultipart(raw, contentType, maxBytes);
        if (parts.image) {
          if (!IMAGE_TYPES.has(parts.image.mimeType)) throw new HttpError(415, 'Only JPEG, PNG and WebP images are accepted');
          image = parts.image;
        }
        input = parseContext(parts.chartContext || parts.context || '{}');
      } else {
        throw new HttpError(415, 'Use application/json or multipart/form-data');
      }

      let marketData = input.marketData, marketContext = input.marketContext || marketData;
      if (image) {
        if (typeof visionAdapter !== 'function')
          throw new HttpError(503, 'Vision adapter is not configured; image was not converted into market data');
        const parsed = await visionAdapter(image, input.chartContext || input);
        marketData = parsed?.marketData;
        marketContext = parsed?.marketContext || marketData;
      }
      validateMarketInput(marketData, marketContext);
      const result = await analyze(marketData, marketContext);
      return send(res, 200, { ok: true, source: image ? 'vision_adapter' : 'structured_context', result });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return send(res, status, { error: status === 500 ? 'VISION_ANALYSIS_FAILED' : error.message });
    }
  };
}

module.exports = { createVisionAnalyzeHandler, decodeBase64Image, parseMultipart, validateMarketInput, DEFAULT_MAX_BYTES };
