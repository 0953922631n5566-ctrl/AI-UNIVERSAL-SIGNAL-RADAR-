'use strict';

const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';
const MIN_CANDLES = 200;
const MIN_CONFIDENCE = 0.98;
const REQUIRED_INDICATORS = ['rsi', 'adx', 'plusDI', 'minusDI', 'macdHistogram', 'ema9', 'ema21', 'ema50', 'volatilityRatio'];

class VisionExtractionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    readable: { type: 'boolean' },
    rejectionReason: { type: 'string' },
    symbol: { type: 'string' },
    timeframe: { type: 'string' },
    overallConfidence: { type: 'number' },
    regime: { type: 'string', enum: ['UPTREND', 'DOWNTREND', 'SIDEWAY', 'RANGING', 'REVERSAL', 'UNCLEAR'] },
    trendDirection: { type: 'string', enum: ['BULLISH', 'BEARISH', 'SIDEWAYS', 'UNCLEAR'] },
    marketStructure: { type: 'string' },
    candlestickPatterns: { type: 'array', items: { type: 'string' } },
    visibleIndicators: { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(REQUIRED_INDICATORS.map(k => [k, { type: 'number' }])),
      required: REQUIRED_INDICATORS },
    nearSupport: { type: 'boolean' },
    nearResistance: { type: 'boolean' },
    candles: { type: 'array', minItems: MIN_CANDLES, maxItems: 500, items: {
      type: 'object', additionalProperties: false,
      properties: {
        epoch: { type: 'integer' }, open: { type: 'number' }, high: { type: 'number' },
        low: { type: 'number' }, close: { type: 'number' }, confidence: { type: 'number' }
      },
      required: ['epoch', 'open', 'high', 'low', 'close', 'confidence']
    }}
  },
  required: ['readable', 'rejectionReason', 'symbol', 'timeframe', 'overallConfidence',
    'regime', 'trendDirection', 'marketStructure', 'candlestickPatterns', 'visibleIndicators',
    'nearSupport', 'nearResistance', 'candles']
};

function validateExtraction(data, chartContext = {}) {
  if (!data || data.readable !== true)
    throw new VisionExtractionError(422, 'CHART_UNREADABLE', data?.rejectionReason || 'Chart details are not readable enough');
  if (!Number.isFinite(data.overallConfidence) || data.overallConfidence < MIN_CONFIDENCE)
    throw new VisionExtractionError(422, 'LOW_VISUAL_CONFIDENCE', 'Visual extraction confidence is below 0.98');
  if (chartContext.symbol && data.symbol.toUpperCase() !== String(chartContext.symbol).toUpperCase())
    throw new VisionExtractionError(422, 'SYMBOL_MISMATCH', 'Detected symbol does not match the requested chart symbol');
  if (chartContext.timeframe && data.timeframe.toUpperCase() !== String(chartContext.timeframe).toUpperCase())
    throw new VisionExtractionError(422, 'TIMEFRAME_MISMATCH', 'Detected timeframe does not match the requested timeframe');
  if (!Array.isArray(data.candles) || data.candles.length < MIN_CANDLES)
    throw new VisionExtractionError(422, 'INSUFFICIENT_CANDLES', 'At least 200 individually readable candles are required');
  let previousEpoch = null;
  for (const [index, c] of data.candles.entries()) {
    if (!Number.isFinite(c.confidence) || c.confidence < MIN_CONFIDENCE)
      throw new VisionExtractionError(422, 'CANDLE_UNREADABLE', `Candle ${index + 1} is not readable with sufficient confidence`);
    if (![c.epoch, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
        c.epoch <= 0 || c.low <= 0 || c.close <= 0 ||
        c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close))
      throw new VisionExtractionError(422, 'INVALID_OHLC', `Candle ${index + 1} has invalid or fabricated OHLC geometry`);
    if (previousEpoch !== null && c.epoch <= previousEpoch)
      throw new VisionExtractionError(422, 'INVALID_CANDLE_ORDER', 'Candle timestamps must be strictly increasing');
    previousEpoch = c.epoch;
  }
  const indicators = data.visibleIndicators;
  if (!indicators || REQUIRED_INDICATORS.some(k => !Number.isFinite(indicators[k])))
    throw new VisionExtractionError(422, 'INDICATORS_UNREADABLE', 'Required indicator values are missing or unreadable');
  if (indicators.rsi < 0 || indicators.rsi > 100 || indicators.adx < 0 ||
      indicators.volatilityRatio < 0 || indicators.plusDI < 0 || indicators.minusDI < 0)
    throw new VisionExtractionError(422, 'INDICATORS_OUT_OF_RANGE', 'One or more extracted indicators are outside valid ranges');
  // Screenshot content cannot prove live-feed freshness. Require freshness metadata from the caller.
  const tickAgeSeconds = chartContext.tickAgeSeconds;
  const ageSeconds = chartContext.ageSeconds;
  const allowRestFallback = chartContext.allowRestFallback === true;
  if (!(Number.isFinite(tickAgeSeconds) && tickAgeSeconds >= 0 && tickAgeSeconds <= 25) &&
      !(allowRestFallback && Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= 180))
    throw new VisionExtractionError(422, 'FRESHNESS_UNVERIFIED', 'Screenshot cannot prove live data freshness; provide trusted tickAgeSeconds <= 25 or explicitly permitted REST ageSeconds <= 180');
  return data;
}

function createOpenAIVisionAdapter({ apiKey = process.env.OPENAI_API_KEY, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch-compatible implementation is required');
  return async function openAIVisionAdapter(image, chartContext = {}) {
    if (!apiKey) throw new VisionExtractionError(503, 'OPENAI_API_KEY_MISSING', 'OpenAI Vision is not configured on this test server');
    if (!image?.buffer || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType))
      throw new VisionExtractionError(415, 'UNSUPPORTED_IMAGE', 'A JPEG, PNG or WebP chart screenshot is required');
    const prompt = [
      'You are a conservative financial-chart visual extraction system. This is DATA EXTRACTION ONLY, not a trading recommendation.',
      'Read only pixels that are genuinely legible. Never infer, interpolate, estimate, smooth, or invent any price, OHLC, timestamp, indicator or candle.',
      'Return readable=false if the screenshot does not visibly contain at least 200 individually distinguishable candles with all four OHLC values and timestamps legible at the displayed scale.',
      'Each candle confidence and overallConfidence must be honest probabilities; use below 0.98 when any digit, wick, timestamp or candle boundary is uncertain.',
      'Extract candles oldest to newest. Epoch values must be Unix seconds read from legible time-axis labels; do not synthesize timestamps. If individual candle timestamps cannot be determined exactly, reject.',
      'Extract the listed indicator values only when their numerical values are visibly printed and legible. Do not calculate or guess them from line shapes. If any required indicator is not visibly numeric, reject.',
      'Determine market structure, trend direction, regime and visible candlestick patterns only from visible evidence. Use UNCLEAR when ambiguous.',
      'No fabricated values. In an unreadable case, set readable=false, provide a concise rejectionReason, and use empty candles / neutral numeric placeholders only as schema fillers; these fillers will be rejected.',
      'Caller chart context: ' + JSON.stringify({ symbol: chartContext.symbol, timeframe: chartContext.timeframe, timezone: chartContext.timezone })
    ].join('\n');
    const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 16000,
          response_format: { type: 'json_schema', json_schema: { name: 'chart_visual_extraction', strict: true, schema } },
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ] }]
        })
      });
    } catch (error) {
      throw new VisionExtractionError(502, 'OPENAI_UNAVAILABLE', `OpenAI Vision request failed: ${error.message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const status = response.status === 429 ? 503 : 502;
      throw new VisionExtractionError(status, 'OPENAI_PROVIDER_ERROR', `OpenAI Vision returned HTTP ${response.status}: ${detail.slice(0, 400)}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new VisionExtractionError(502, 'OPENAI_EMPTY_RESPONSE', 'OpenAI Vision returned no structured extraction');
    let extraction;
    try { extraction = JSON.parse(content); }
    catch { throw new VisionExtractionError(502, 'OPENAI_INVALID_JSON', 'OpenAI Vision returned invalid structured JSON'); }
    validateExtraction(extraction, chartContext);
    const candles = extraction.candles.map(({ confidence, ...c }) => c);
    const indicators = { ...extraction.visibleIndicators, nearSupport: extraction.nearSupport, nearResistance: extraction.nearResistance };
    const freshness = {
      tickAgeSeconds: chartContext.tickAgeSeconds,
      ageSeconds: chartContext.ageSeconds,
      allowRestFallback: chartContext.allowRestFallback === true
    };
    const marketData = { candles, indicators, regime: extraction.regime, ...freshness };
    const marketContext = {
      regime: extraction.regime,
      indicators,
      reason: extraction.marketStructure,
      visual: {
        symbol: extraction.symbol, timeframe: extraction.timeframe,
        trendDirection: extraction.trendDirection,
        marketStructure: extraction.marketStructure,
        candlestickPatterns: extraction.candlestickPatterns,
        overallConfidence: extraction.overallConfidence,
        source: 'openai-gpt-4o-vision'
      }
    };
    return { marketData, marketContext };
  };
}

module.exports = { createOpenAIVisionAdapter, validateExtraction, VisionExtractionError, MIN_CANDLES, MIN_CONFIDENCE };
