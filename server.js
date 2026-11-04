const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 300;
const MAX_AGE_MS = 30000;
const MIN_POINTS = 5;
const REFRESH_SECONDS = 2;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// OCR is the only market-price source. No provider API, generated price, or fallback feed.
let priceHistory = [];
let lastUploadAt = null;
let lastUploadSource = null;
let lastUploadTimestamp = null;
let rejectedUploads = 0;

function normalizePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1000000 ? n : null;
}

function getSignal() {
  const now = Date.now();
  const latest = priceHistory[priceHistory.length - 1];
  const ageMs = latest ? now - latest.receivedAt : Infinity;
  const fresh = !!latest && ageMs >= 0 && ageMs <= MAX_AGE_MS;
  const base = {
    symbol: 'EUR/USD',
    market: 'OCR',
    timeframe: 'M1',
    source: 'ANDROID_OCR',
    apiStatus: fresh ? 'connected' : 'waiting',
    feedStatus: fresh ? 'LIVE' : 'WAITING_FOR_OCR',
    signal: 'STANDBY',
    regime: fresh ? 'MODEL_NOT_CONFIGURED' : 'NO FRESH OCR DATA',
    price: latest && fresh ? latest.price.toFixed(5) : '—',
    priceTimestamp: latest ? new Date(latest.timestamp).toISOString() : null,
    receivedAt: latest ? new Date(latest.receivedAt).toISOString() : null,
    dataAgeSeconds: latest ? Math.max(0, Math.floor(ageMs / 1000)) : null,
    readingsLoaded: priceHistory.length,
    minimumReadings: MIN_POINTS,
    refreshIntervalSeconds: REFRESH_SECONDS
  };

  if (!fresh) {
    return {
      ...base,
      apiStatus: 'waiting',
      feedStatus: 'STALE_OR_MISSING',
      reason: latest ? 'ราคาจาก APK เก่าเกิน 30 วินาที · หยุดออกสัญญาณ' : 'ยังไม่ได้รับราคาจาก APK OCR'
    };
  }

  // OCR price extraction is not chart perception. Keep all directional outputs
  // disabled until a real perception + decision model has been configured and evaluated.
  return {
    ...base,
    signal: 'STANDBY',
    reason: 'รับราคา OCR แล้ว แต่ยังไม่มี perception และ decision model ที่ผ่านการประเมิน · ปิด CALL/PUT ไว้'
  };
}
app.get('/health', (_req, res) => {
  const latest = priceHistory[priceHistory.length - 1];
  const ageMs = latest ? Date.now() - latest.receivedAt : null;
  res.json({
    status: 'ok',
    priceSource: 'ANDROID_OCR_ONLY',
    externalMarketApis: false,
    ocrConnected: !!latest && ageMs >= 0 && ageMs <= MAX_AGE_MS,
    lastPriceReceivedAt: latest ? new Date(latest.receivedAt).toISOString() : null,
    dataAgeSeconds: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 1000)),
    readingsLoaded: priceHistory.length,
    rejectedUploads,
    refreshIntervalSeconds: REFRESH_SECONDS
  });
});

// APK contract: POST /api/upload-screen { detectedPrice, timestamp?, symbol?, source? }
// Optional protection: set OCR_INGEST_TOKEN in Render and send it as x-ocr-token.
app.post('/api/upload-screen', (req, res) => {
  const expectedToken = process.env.OCR_INGEST_TOKEN;
  if (!expectedToken) {
    rejectedUploads++;
    return res.status(503).json({ status: 'error', message: 'OCR_INGEST_TOKEN is not configured on the server' });
  }
  if (req.get('x-ocr-token') !== expectedToken) {
    rejectedUploads++;
    return res.status(401).json({ status: 'error', message: 'Unauthorized OCR uploader' });
  }
  const symbol = String(req.body && req.body.symbol || 'EUR/USD').replace(/\s/g, '').toUpperCase();
  if (symbol !== 'EUR/USD') {
    rejectedUploads++;
    return res.status(400).json({ status: 'error', message: 'Only EUR/USD is enabled' });
  }
  const price = normalizePrice(req.body && req.body.detectedPrice);
  if (price === null) {
    rejectedUploads++;
    return res.status(400).json({ status: 'error', message: 'A real detectedPrice is required; no fallback price is generated' });
  }
  const suppliedTimestamp = req.body && req.body.timestamp;
  const parsedTimestamp = suppliedTimestamp == null ? Date.now() :
    (typeof suppliedTimestamp === 'number' ? suppliedTimestamp : Date.parse(suppliedTimestamp));
  if (!Number.isFinite(parsedTimestamp) || parsedTimestamp > Date.now() + 10000 || Date.now() - parsedTimestamp > 60000) {
    rejectedUploads++;
    return res.status(400).json({ status: 'error', message: 'OCR timestamp is invalid or stale' });
  }
  const receivedAt = Date.now();
  const item = {
    price,
    timestamp: parsedTimestamp,
    receivedAt,
    source: String(req.body && req.body.source || 'ANDROID_OCR').slice(0, 40)
  };
  const previous = priceHistory[priceHistory.length - 1];
  // Drop exact duplicate frames; they must not manufacture momentum.
  if (previous && previous.price === price && Math.abs(previous.timestamp - parsedTimestamp) < 1000) {
    return res.json({ status: 'duplicate_ignored', price: price.toFixed(5), readingsLoaded: priceHistory.length });
  }
  priceHistory.push(item);
  if (priceHistory.length > MAX_HISTORY) priceHistory = priceHistory.slice(-MAX_HISTORY);
  lastUploadAt = receivedAt;
  lastUploadTimestamp = parsedTimestamp;
  lastUploadSource = item.source;
  const result = getSignal();
  return res.json({ status: 'success', price: price.toFixed(5), signal: 'STANDBY',
    reason: result.reason, readingsLoaded: priceHistory.length, receivedAt: new Date(receivedAt).toISOString() });
});

app.get('/api/signal', (_req, res) => res.json(getSignal()));

app.get('/api/config', (_req, res) => res.json({
  symbol: 'EUR/USD', market: 'OCR', timeframe: 'M1',
  priceSource: 'ANDROID_OCR_ONLY', externalMarketApis: false,
  manualOnly: true, automaticBrokerOrders: false,
  staleAfterSeconds: MAX_AGE_MS / 1000,
  minimumReadings: MIN_POINTS,
  refreshIntervalSeconds: REFRESH_SECONDS
}));

app.listen(PORT, () => {
  console.log('AI Universal Signal Radar · OCR-only server listening on port', PORT);
});
