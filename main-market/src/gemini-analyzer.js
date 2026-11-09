const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const cache = new Map();
const SUCCESS_CACHE_MS = 70_000;
const FAILURE_CACHE_MS = 8_000;
const REQUEST_TIMEOUT_MS = 8_000;
// Free-tier policy: exactly one HTTP attempt per M1 candle; never retry HTTP 429.
const MAX_RETRIES = 0;
const BASE_BACKOFF_MS = 350;
let keyCursor = 0;

function resolveApiKeys(apiKey, apiKeys) {
  // An explicitly supplied empty key means "no key" (also makes tests deterministic).
  // Only read Render environment keys when the caller omits both key arguments.
  const useEnvironment = apiKey === undefined && apiKeys === undefined;
  const configured = Array.isArray(apiKeys) ? apiKeys
    : useEnvironment ? String(process.env.GEMINI_API_KEYS || "").split(/[\n,;]+/) : [];
  const primary = apiKey === undefined
    ? (useEnvironment ? process.env.GEMINI_API_KEY || "" : "")
    : apiKey;
  return [...new Set([...configured, primary].map(v => String(v || "").trim()).filter(Boolean))];
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function retryable429Message(message) { return !/(per[- ]day|daily quota|requests per day|quota.*exhausted.*day)/i.test(message || ""); }

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    signal: { type: "STRING", enum: ["CALL", "PUT", "STANDBY"] },
    regime: { type: "STRING", enum: ["UPTREND", "DOWNTREND", "SIDEWAY", "HIGH_VOLATILITY", "REVERSAL", "UNCLEAR"] },
    confidence: { type: "NUMBER" },
    reason: { type: "STRING" },
    evidence: { type: "ARRAY", items: { type: "STRING" } },
    riskFlags: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" }
  },
  required: ["signal", "regime", "confidence", "reason", "evidence", "riskFlags", "summary"]
};

const SYSTEM_INSTRUCTION = [
  "You are the sole market-direction analyst for a EUR/USD-style spot FX M1 signal system.",
  "Analyze only the supplied closed M1 OHLC candles and calculated technical indicators.",
  "You alone choose CALL, PUT, or STANDBY. No other AI or voting engines participate.",
  "Do not force a direction. Choose STANDBY when evidence is mixed, weak, late, contradictory, or insufficient.",
  "Do not invent prices, indicators, volume, news, or market context. FX volume may be unavailable; never infer real exchange volume.",
  "Consider trend, momentum, MACD, RSI, volatility, candle structure, support/resistance and the latest four closed candles.",
  "Confidence is evidence strength from 0 to 100, never a win probability.",
  "Return only the JSON object required by the response schema. Use concise Thai reasons/evidence where possible.",
  "This is decision support only; never describe or initiate broker order execution."
].join(" ");

function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * multiplier + value * (1 - multiplier);
  return value;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function buildTechnicalIndicators(candles) {
  const closes = candles.map(c => c.close);
  const ranges = candles.slice(1).map((c, index) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[index].close),
    Math.abs(c.low - candles[index].close)
  ));
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const recent = candles.slice(-4);
  const supportWindow = candles.slice(-20);
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const macdLine = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
  const macdSeries = [];
  for (let i = 25; i < closes.length; i++) {
    const fast = ema(closes.slice(0, i + 1), 12);
    const slow = ema(closes.slice(0, i + 1), 26);
    if (fast !== null && slow !== null) macdSeries.push(fast - slow);
  }
  const macdSignal = macdSeries.length >= 9 ? ema(macdSeries, 9) : null;
  const atr14 = ranges.length >= 14 ? ranges.slice(-14).reduce((a, b) => a + b, 0) / 14 : null;
  const range = last.high - last.low;
  return {
    ema9: ema(closes, 9), ema21: ema(closes, 21), ema50: ema(closes, 50),
    rsi14: rsi(closes, 14), macd: macdLine, macdSignal,
    macdHistogram: macdLine !== null && macdSignal !== null ? macdLine - macdSignal : null,
    atr14, atrPercent: atr14 !== null && last.close > 0 ? atr14 / last.close * 100 : null,
    support20: Math.min(...supportWindow.map(c => c.low)),
    resistance20: Math.max(...supportWindow.map(c => c.high)),
    lastCandleBodyRatio: range > 0 ? Math.abs(last.close - last.open) / range : 0,
    lastCandleDirection: last.close > last.open ? "BULLISH" : last.close < last.open ? "BEARISH" : "DOJI",
    previousClose: previous?.close ?? null,
    fourCandleCloses: recent.map(c => c.close),
    fourCandleNetChange: recent.length > 1 ? recent.at(-1).close - recent[0].open : null
  };
}

function standby(reason, extra = {}) {
  return {
    signal: "STANDBY", regime: "UNCLEAR", confidence: 0, reason,
    evidence: [], riskFlags: [], summary: reason, strategy: "GEMINI_PRIMARY_ANALYZER",
    provider: "GEMINI", model: MODEL, confidenceMeaning: "MODEL_REPORTED_EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY",
    ...extra
  };
}

function validateDecision(value) {
  if (!value || !["CALL", "PUT", "STANDBY"].includes(value.signal) ||
      !["UPTREND", "DOWNTREND", "SIDEWAY", "HIGH_VOLATILITY", "REVERSAL", "UNCLEAR"].includes(value.regime) ||
      !Number.isFinite(value.confidence) || typeof value.reason !== "string" ||
      !Array.isArray(value.evidence) || !Array.isArray(value.riskFlags) ||
      typeof value.summary !== "string") {
    throw new Error("Gemini JSON did not match the required decision schema");
  }
  const signal = value.signal;
  return {
    signal,
    regime: value.regime,
    confidence: Math.max(0, Math.min(100, value.confidence)),
    score: Math.max(0, Math.min(100, value.confidence)),
    reason: value.reason.slice(0, 500),
    evidence: value.evidence.filter(v => typeof v === "string").slice(0, 8),
    riskFlags: value.riskFlags.filter(v => typeof v === "string").slice(0, 8),
    summary: value.summary.slice(0, 500),
    strategy: "GEMINI_PRIMARY_ANALYZER",
    provider: "GEMINI",
    model: MODEL,
    confidenceMeaning: "MODEL_REPORTED_EVIDENCE_STRENGTH_NOT_WIN_PROBABILITY"
  };
}

async function requestGemini({ symbol, candles, indicators, apiKeys, fetchImpl, now, requestId, startedAt, sleepImpl = sleep, randomImpl = Math.random }) {
  const model = process.env.GEMINI_MODEL || MODEL;
  const payload = { symbol, timeframe: "M1", analysisTimestamp: new Date(now).toISOString(),
    candleCount: candles.length,
    closedCandles: candles.map(c => ({ epoch: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
    indicators, task: "Decide the next M1 direction from the supplied evidence. Do not treat the current in-progress candle as closed." };
  let lastError;
  const attempts = MAX_RETRIES + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const keyIndex = (keyCursor + attempt) % apiKeys.length;
    console.info("[gemini] request_started", { requestId, symbol, timeframe: "M1", model,
      attempt: attempt + 1, keySlot: keyIndex + 1, keyCount: apiKeys.length,
      candleCount: candles.length, latestClosedCandleEpoch: candles.at(-1)?.epoch ?? null,
      analysisTimestamp: new Date(now).toISOString() });
    try {
      const response = await fetchImpl(API_URL + encodeURIComponent(model) + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKeys[keyIndex] },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 700, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
        })
      });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.clone().json())?.error?.message || ""; } catch {}
        const error = new Error(response.status === 429 ? "Gemini rate limit" :
          response.status >= 500 ? "Gemini service unavailable" : "Gemini API request rejected (" + response.status + ")");
        error.status = response.status; error.detail = detail; throw error;
      }
      const body = await response.json();
      const text = body?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
      if (!text) throw new Error("Gemini returned no JSON candidate");
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("Gemini returned invalid JSON"); }
      const decision = validateDecision(parsed);
      keyCursor = (keyIndex + 1) % apiKeys.length;
      console.info("[gemini] response_success", { requestId, symbol, timeframe: "M1", model,
        httpStatus: response.status, durationMs: Date.now() - startedAt, attempt: attempt + 1,
        keySlot: keyIndex + 1, signal: decision.signal, regime: decision.regime, confidence: decision.confidence });
      return decision;
    } catch (error) {
      lastError = error;
      if (error?.status !== 429 || !retryable429Message(error?.detail) || attempt >= attempts - 1) throw error;
      const delayMs = Math.min(2_000, BASE_BACKOFF_MS * (2 ** attempt)) + Math.floor(randomImpl() * 200);
      console.warn("[gemini] retry_scheduled", { requestId, symbol, status: error.status,
        attempt: attempt + 1, nextKeySlot: ((keyIndex + 1) % apiKeys.length) + 1,
        delayMs, reason: "HTTP_429_EXPONENTIAL_BACKOFF" });
      await sleepImpl(delayMs);
    }
  }
  throw lastError || new Error("Gemini request attempts exhausted");
}

/** One Gemini request per symbol/closed-candle epoch; in-flight calls are shared. */
export async function analyzeWithGemini({ symbol, candles, indicators,
  apiKey, apiKeys, fetchImpl = globalThis.fetch,
  now = Date.now(), sleepImpl = sleep, randomImpl = Math.random }) {
  const keys = resolveApiKeys(apiKey, apiKeys);
  if (!keys.length) return standby("GEMINI_API_KEY ยังไม่ได้ตั้งค่าใน Render Environment");
  if (typeof fetchImpl !== "function") return standby("เซิร์ฟเวอร์ไม่มี fetch สำหรับเรียก Gemini");
  const key = String(symbol || "UNKNOWN") + ":" + String(candles.at(-1)?.epoch ?? "NO_EPOCH");
  const cached = cache.get(key);
  if (cached && (cached.promise || cached.expiresAt > now)) return cached.promise || cached.result;
  const requestId = key, startedAt = Date.now();
  const promise = requestGemini({ symbol, candles, indicators, apiKeys: keys, fetchImpl,
    now, requestId, startedAt, sleepImpl, randomImpl })
    .catch(error => {
      console.error("[gemini] request_failed", { requestId, symbol, timeframe: "M1", model: MODEL,
        durationMs: Date.now() - startedAt, httpStatus: error?.status || null,
        errorName: error?.name || "Error", error: error?.message || String(error) });
      return standby("Gemini วิเคราะห์ไม่สำเร็จ: " + error.message, { providerStatus: "ERROR" });
    })
    .then(result => {
      const failed = result.signal === "STANDBY" && result.providerStatus === "ERROR";
      console.info("[gemini] final_decision", { requestId, symbol, timeframe: "M1", model: MODEL,
        signal: result.signal, regime: result.regime, confidence: result.confidence ?? result.score ?? 0,
        providerStatus: failed ? "ERROR" : "SUCCESS", reason: result.reason });
      cache.set(key, { result, expiresAt: Date.now() + (failed ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS) });
      return result;
    });
  cache.set(key, { promise, expiresAt: Infinity });
  return promise;
}

export function clearGeminiAnalysisCache() {
  cache.clear();
}

export const GEMINI_MODEL = MODEL;
