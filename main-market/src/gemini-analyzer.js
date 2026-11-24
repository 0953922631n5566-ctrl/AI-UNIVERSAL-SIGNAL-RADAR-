const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 6500;
const DEFAULT_DAILY_BUDGET = 60;
const SUCCESS_CACHE_MS = 70_000;
const cache = new Map();
const inFlight = new Map();
let quotaDay = "";
let requestsToday = 0;

function keysFromEnv() {
  const values = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
  return [...new Set(values)];
}
function dailyBudget() {
  const value = Number(process.env.GEMINI_MAX_REQUESTS_PER_DAY || DEFAULT_DAILY_BUDGET);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : DEFAULT_DAILY_BUDGET;
}
function resetQuotaIfNeeded(now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== quotaDay) { quotaDay = day; requestsToday = 0; }
}
export function geminiQuotaStatus(now = Date.now()) {
  resetQuotaIfNeeded(now);
  return { model: MODEL, requestsToday, dailyBudget: dailyBudget(),
    remaining: Math.max(0, dailyBudget() - requestsToday), resetsAtUtc: new Date(Date.UTC(
      new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1
    )).toISOString() };
}
function ema(values, period) {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i++) result = values[i] * alpha + result * (1 - alpha);
  return result;
}
function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  const start = Math.max(1, values.length - period);
  for (let i = start; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}
function macd(values) {
  const line = [];
  for (let i = 25; i < values.length; i++) {
    const slice = values.slice(0, i + 1);
    const fast = ema(slice, 12), slow = ema(slice, 26);
    if (fast !== null && slow !== null) line.push(fast - slow);
  }
  const current = line.at(-1) ?? null;
  const signal = line.length >= 9 ? ema(line, 9) : null;
  return { line: current, signal, histogram: current !== null && signal !== null ? current - signal : null };
}
export function buildTechnicalIndicators(candles, liveCandle = null) {
  const source = liveCandle ? [...candles, liveCandle] : candles;
  const closes = source.map(c => Number(c.close)).filter(Number.isFinite);
  const last = source.at(-1), prior = source.at(-2);
  const ranges = source.slice(1).map((c, i) => Math.max(
    c.high - c.low, Math.abs(c.high - source[i].close), Math.abs(c.low - source[i].close)
  ));
  const atr14 = ranges.length >= 14 ? ranges.slice(-14).reduce((a, b) => a + b, 0) / 14 : null;
  const recent = source.slice(-4);
  const recentRange = last ? last.high - last.low : 0;
  const macdValues = macd(closes);
  return {
    ema9: ema(closes, 9), ema21: ema(closes, 21), ema50: ema(closes, 50),
    rsi14: rsi(closes), macd: macdValues.line, macdSignal: macdValues.signal,
    macdHistogram: macdValues.histogram,
    atr14, atrPercent: atr14 && last?.close ? atr14 / last.close * 100 : null,
    support20: Math.min(...source.slice(-20).map(c => c.low)),
    resistance20: Math.max(...source.slice(-20).map(c => c.high)),
    lastCandleBodyRatio: recentRange > 0 ? Math.abs(last.close - last.open) / recentRange : 0,
    lastCandleDirection: last?.close > last?.open ? "BULLISH" : last?.close < last?.open ? "BEARISH" : "DOJI",
    previousClose: prior?.close ?? null,
    fourCandleCloses: recent.map(c => c.close),
    fourCandleNetChange: recent.length > 1 ? recent.at(-1).close - recent[0].open : null
  };
}
/**
 * Cheap local gate: calculate on stream ticks, but call Gemini only when
 * trend, momentum and the current candle point in the same direction.
 * This gate never emits a trade direction; Gemini remains the sole decider.
 */
export function assessGeminiSetup(closedCandles, liveCandle) {
  if (!Array.isArray(closedCandles) || closedCandles.length < 54 ||
      !liveCandle || liveCandle.live !== true ||
      ![liveCandle.epoch, liveCandle.open, liveCandle.high, liveCandle.low, liveCandle.close].every(Number.isFinite)) {
    return { eligible: false, direction: null, reason: "ข้อมูล OHLC สำหรับคัดจังหวะยังไม่ครบ", indicators: null };
  }
  const indicators = buildTechnicalIndicators(closedCandles, liveCandle);
  const atr = indicators.atr14;
  const range = liveCandle.high - liveCandle.low;
  const bodyRatio = range > 0 ? Math.abs(liveCandle.close - liveCandle.open) / range : 0;
  if (![atr, indicators.ema9, indicators.ema21, indicators.rsi14, indicators.macdHistogram].every(Number.isFinite) || atr <= 0) {
    return { eligible: false, direction: null, reason: "รอ Indicator ภายในระบบให้ครบ", indicators };
  }
  const gapAtr = Math.abs(indicators.ema9 - indicators.ema21) / atr;
  const extensionAtr = Math.abs(liveCandle.close - indicators.ema9) / atr;
  const metrics = { gapAtr, extensionAtr, bodyRatio };
  if (gapAtr < 0.025) return { eligible: false, direction: null, reason: "ตลาดแคบ · EMA9/21 ยังไม่แยกทิศทาง", indicators, metrics };
  if (range > atr * 2.8) return { eligible: false, direction: null, reason: "แท่งปัจจุบันผันผวนเกิน ATR · รอจังหวะใหม่", indicators, metrics };
  if (extensionAtr > 1.5) return { eligible: false, direction: null, reason: "ราคาออกห่าง EMA9 มากเกินไป · ไม่ไล่ราคา", indicators, metrics };
  if (bodyRatio < 0.08) return { eligible: false, direction: null, reason: "แรงของแท่งปัจจุบันยังไม่ชัด", indicators, metrics };
  const call = indicators.ema9 > indicators.ema21 && liveCandle.close > indicators.ema9 &&
    indicators.macdHistogram > 0 && indicators.rsi14 >= 50 && indicators.rsi14 <= 76;
  const put = indicators.ema9 < indicators.ema21 && liveCandle.close < indicators.ema9 &&
    indicators.macdHistogram < 0 && indicators.rsi14 <= 50 && indicators.rsi14 >= 24;
  const direction = call ? "CALL" : put ? "PUT" : null;
  return {
    eligible: Boolean(direction), direction, indicators,
    reason: direction ? "พบจังหวะ " + direction + " เบื้องต้น · ส่งให้ Gemini ตรวจยืนยัน" : "ทิศทาง EMA, MACD, RSI ยังไม่สอดคล้อง",
    metrics
  };
}

export function hasCriticalRiskFlags(flags = []) {
  // Only data-integrity / impossible-input risks are hard blockers. Market regimes
  // (sideways, volatile, reversal) are advisory so Gemini can find more setups.
  const critical = /stale|missing data|insufficient data|data quality|invalid (?:ohlc|price|candle)|future data|contradictory data|ข้อมูล.*(ไม่ครบ|ล้า|ผิดปกติ)|ไม่มีข้อมูล|ราคา.*ผิดปกติ/iu;
  return Array.isArray(flags) && flags.some(flag => typeof flag === "string" && critical.test(flag));
}
function standby(reason, extra = {}) {
  return { signal: "STANDBY", regime: "UNCLEAR", confidence: 0, reason,
    evidence: [], riskFlags: [], summary: reason, provider: "GEMINI", model: MODEL, ...extra };
}
function validateDecision(value) {
  if (!value || !["CALL", "PUT", "STANDBY"].includes(value.signal) ||
      !["UPTREND", "DOWNTREND", "SIDEWAY", "HIGH_VOLATILITY", "REVERSAL", "UNCLEAR"].includes(value.regime) ||
      !Number.isFinite(value.confidence) || typeof value.reason !== "string" ||
      !Array.isArray(value.evidence) || !Array.isArray(value.riskFlags) || typeof value.summary !== "string") {
    throw new Error("Gemini response schema invalid");
  }
  // Gemini may serialize a normalized confidence as 0..1 or as 0..100.
  // Convert fractional values to the documented 0..100 evidence-strength scale.
  const normalizedConfidence = value.confidence >= 0 && value.confidence <= 1
    ? value.confidence * 100 : value.confidence;
  return { signal: value.signal, regime: value.regime,
    confidence: Math.max(0, Math.min(100, normalizedConfidence)),
    reason: value.reason.slice(0, 400),
    evidence: value.evidence.filter(v => typeof v === "string").slice(0, 6),
    riskFlags: value.riskFlags.filter(v => typeof v === "string").slice(0, 6),
    summary: value.summary.slice(0, 400), provider: "GEMINI", model: MODEL,
    strategy: "GEMINI_PRIMARY_ADAPTIVE_M1" };
}
export async function analyzeWithGemini({ symbol, closedCandles, liveCandle, now = Date.now(), fetchImpl = globalThis.fetch }) {
  const sourceEpoch = Number(liveCandle?.epoch);
  if (!Number.isFinite(sourceEpoch) || liveCandle?.live !== true) return standby("ยังไม่มีแท่ง M1 ปัจจุบันจาก Streaming");
  const cacheKey = String(symbol) + ":" + sourceEpoch;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const keys = keysFromEnv();
  if (!keys.length) return standby("ยังไม่ได้ตั้ง GEMINI_API_KEY หรือ GEMINI_API_KEYS ใน Render");
  resetQuotaIfNeeded(now);
  if (requestsToday >= dailyBudget()) return standby("ถึงงบเรียก Gemini รายวันแล้ว · รอรีเซ็ต UTC", { providerStatus: "QUOTA_BUDGET" });
  if (!Array.isArray(closedCandles) || closedCandles.length < 54) return standby("ข้อมูลแท่งปิด M1 ยังไม่ครบ 54 แท่ง");
  if (typeof fetchImpl !== "function") return standby("ไม่พบ fetch สำหรับ Gemini");
  const indicators = buildTechnicalIndicators(closedCandles, liveCandle);
  const payload = {
    symbol, timeframe: "M1", sourceCandleEpoch: sourceEpoch,
    targetCandleEpoch: sourceEpoch + 60,
    closedCandles: closedCandles.slice(-54).map(c => ({ epoch: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
    currentLiveCandleSnapshot: { epoch: liveCandle.epoch, open: liveCandle.open, high: liveCandle.high, low: liveCandle.low, close: liveCandle.close },
    indicators,
    instruction: "ทำนายทิศทางของแท่ง M1 เป้าหมายที่เริ่ม sourceCandleEpoch + 60 เท่านั้น ห้ามทำนายแท่งปัจจุบัน"
  };
  const promise = (async () => {
    const key = keys[requestsToday % keys.length];
    requestsToday++;
    const response = await fetchImpl(API_URL + encodeURIComponent(MODEL) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "คุณเป็นนักวิเคราะห์ EUR/USD M1 ใช้เฉพาะข้อมูลที่ให้มา วิเคราะห์ทั้งแนวโน้ม การแกว่งตัว การกลับตัว โมเมนตัม EMA RSI MACD ATR โครงสร้างแท่ง แนวรับแนวต้าน เลือก CALL หรือ PUT ให้บ่อยขึ้นเมื่อเห็นอคติทิศทางระยะสั้นที่พอมีเหตุผล แม้ตลาด SIDEWAY หรือมีความผันผวนก็ยังประเมินจังหวะสั้นได้และใส่คำเตือนใน riskFlags อย่าตั้ง STANDBY เพียงเพราะตลาดไม่เป็นเทรนด์หรือมีคำเตือนทั่วไป ใช้ STANDBY เมื่อข้อมูลไม่ครบ/ไม่น่าเชื่อถือหรือไม่มีทิศทางที่พอแยกได้จริง confidence คือระดับความชัดของหลักฐาน ไม่ใช่โอกาสชนะ ห้ามแต่งข้อมูล ห้ามใช้ข้อมูลแท่งอนาคต ตอบ JSON เท่านั้น" }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: {
            signal: { type: "STRING", enum: ["CALL", "PUT", "STANDBY"] },
            regime: { type: "STRING", enum: ["UPTREND", "DOWNTREND", "SIDEWAY", "HIGH_VOLATILITY", "REVERSAL", "UNCLEAR"] },
            confidence: { type: "NUMBER" }, reason: { type: "STRING" },
            evidence: { type: "ARRAY", items: { type: "STRING" } },
            riskFlags: { type: "ARRAY", items: { type: "STRING" } }, summary: { type: "STRING" }
          }, required: ["signal", "regime", "confidence", "reason", "evidence", "riskFlags", "summary"] }
        }
      })
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.clone().json())?.error?.message || ""; } catch {}
      const error = new Error("Gemini HTTP " + response.status + (detail ? ": " + detail.slice(0, 180) : ""));
      error.status = response.status; throw error;
    }
    const body = await response.json();
    const raw = body?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!raw) throw new Error("Gemini returned empty response");
    const decision = validateDecision(JSON.parse(raw));
    const result = { ...decision, indicators, sourceCandleEpoch: sourceEpoch,
      targetCandleEpoch: sourceEpoch + 60, analyzedAt: new Date(now).toISOString() };
    cache.set(cacheKey, { result, expiresAt: Date.now() + SUCCESS_CACHE_MS });
    console.info("[gemini] decision", { symbol, sourceCandleEpoch: sourceEpoch,
      targetCandleEpoch: sourceEpoch + 60, signal: result.signal, regime: result.regime, confidence: result.confidence,
      riskFlagCount: result.riskFlags.length, riskFlags: result.riskFlags, evidenceCount: result.evidence.length,
      requestsToday, dailyBudget: dailyBudget() });
    return result;
  })().catch(error => {
    console.error("[gemini] request failed", { symbol, sourceCandleEpoch: sourceEpoch,
      status: error.status || null, message: error.message });
    const result = standby("Gemini วิเคราะห์ไม่สำเร็จ: " + error.message, { providerStatus: error.status === 429 ? "RATE_LIMIT" : "ERROR",
      indicators, sourceCandleEpoch: sourceEpoch, targetCandleEpoch: sourceEpoch + 60 });
    cache.set(cacheKey, { result, expiresAt: Date.now() + SUCCESS_CACHE_MS });
    return result;
  }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, promise);
  return promise;
}
export function clearGeminiAnalysisCache() {
  cache.clear(); inFlight.clear(); quotaDay = ""; requestsToday = 0;
}
export const GEMINI_MODEL = MODEL;
