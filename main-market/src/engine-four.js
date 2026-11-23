/** Engine 4: adaptive Trend Pullback / Sideway Range Reversal. */
export const ENGINE4_STRATEGY = "MULTI_DIMENSION_ADAPTIVE_TREND_RANGE_NO_SCORE";

function validCandle(c, provisional = false) {
  return c && c.live === false && (!provisional || c.provisional === true) &&
    Number.isFinite(c.epoch) &&
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low;
}

function notReady(status, reason, extra = {}) {
  return { ready: false, decisionMade: false, signal: null,
    candidateSignal: null, status, strategy: ENGINE4_STRATEGY, reason, ...extra };
}

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let value = seed / period;
  out[period - 1] = value;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    value = values[i] * alpha + value * (1 - alpha);
    out[i] = value;
  }
  return out;
}

function rmaLast(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  for (let i = period; i < values.length; i++) {
    value = (value * (period - 1) + values[i]) / period;
  }
  return value;
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);
  const ema8 = emaSeries(closes, 8).at(-1);
  const ema21 = emaSeries(closes, 21).at(-1);

  const trueRanges = [];
  const gains = [];
  const losses = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previousClose = candles[i - 1].close;
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose)
    ));
    const delta = current.close - previousClose;
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const atr14 = rmaLast(trueRanges, 14);
  const avgGain = rmaLast(gains, 5);
  const avgLoss = rmaLast(losses, 5);
  const rsi5 = avgLoss === 0
    ? (avgGain === 0 ? 50 : 100)
    : 100 - (100 / (1 + avgGain / avgLoss));

  const macdFast = emaSeries(closes, 4);
  const macdSlow = emaSeries(closes, 9);
  const macd = closes.map((_, i) =>
    macdFast[i] === null || macdSlow[i] === null ? null : macdFast[i] - macdSlow[i]
  );
  const firstMacdIndex = macd.findIndex(Number.isFinite);
  const macdValues = macd.slice(firstMacdIndex);
  const macdSignalSeries = emaSeries(macdValues, 4);
  const macdLine = macd.at(-1);
  const macdSignal = macdSignalSeries.at(-1);

  const bbValues = closes.slice(-14);
  const bbMid = bbValues.reduce((sum, x) => sum + x, 0) / bbValues.length;
  const variance = bbValues.reduce((sum, x) => sum + (x - bbMid) ** 2, 0) / bbValues.length;
  const bbDeviation = Math.sqrt(variance);
  const bbUpper = bbMid + 2 * bbDeviation;
  const bbLower = bbMid - 2 * bbDeviation;

  if (![ema8, ema21, atr14, rsi5, macdLine, macdSignal, bbUpper, bbLower].every(Number.isFinite)) {
    return null;
  }
  return { ema8, ema21, atr14, rsi5, macdLine, macdSignal, bbUpper, bbLower };
}

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const liveCandle = options.liveCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(liveCandle, true)) {
    return notReady("LIVE_M1_PREVIEW_NOT_READY",
      "Engine 4 ต้องใช้แท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  }

  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => c && c.epoch <= liveCandle.epoch && c.epoch !== liveCandle.epoch && validCandle(c))
    .slice(-60);
  if (history.length < 21) {
    return notReady("INSUFFICIENT_HISTORY", "Engine 4 ต้องมีแท่งย้อนหลังอย่างน้อย 21 แท่ง");
  }
  const series = [...history, liveCandle];
  const indicators = calculateIndicators(series);
  if (!indicators) {
    return notReady("INDICATORS_NOT_READY", "ข้อมูล EMA / ATR / MACD / RSI / Bollinger ยังไม่ครบ");
  }

  const { ema8, ema21, atr14, rsi5, macdLine, macdSignal, bbUpper, bbLower } = indicators;
  const isTrending = Math.abs(ema8 - ema21) > atr14 * 0.4;
  const isSideway = !isTrending;
  const trendCall = isTrending && ema8 > ema21 &&
    liveCandle.low <= ema8 && liveCandle.close > liveCandle.open &&
    macdLine > macdSignal;
  const trendPut = isTrending && ema8 < ema21 &&
    liveCandle.high >= ema8 && liveCandle.close < liveCandle.open &&
    macdLine < macdSignal;
  const rangeCall = isSideway && liveCandle.low <= bbLower &&
    rsi5 < 30 && liveCandle.close > liveCandle.open;
  const rangePut = isSideway && liveCandle.high >= bbUpper &&
    rsi5 > 70 && liveCandle.close < liveCandle.open;

  const signal = trendCall || rangeCall ? "CALL"
    : trendPut || rangePut ? "PUT" : null;
  const regime = isTrending ? "TREND" : "SIDEWAY";
  const mode = trendCall || trendPut ? "TREND_PULLBACK"
    : rangeCall || rangePut ? "RANGE_REVERSAL" : null;
  const sourceCandleEpoch = liveCandle.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const metrics = {
    regime, mode, ema8, ema21, emaGap: Math.abs(ema8 - ema21), atr14,
    macdLine, macdSignal, rsi5, bbUpper, bbLower,
    sourceCandleEpoch, targetCandleEpoch
  };

  if (!signal) {
    return {
      ...notReady("NO_ADAPTIVE_ENTRY", "ยังไม่ครบเงื่อนไข Trend Pullback หรือ Range Reversal"),
      sourceCandleEpoch, targetCandleEpoch, analysisMode: mode || regime, metrics
    };
  }

  const reason = mode === "TREND_PULLBACK"
    ? "TREND · EMA 8/21 + ย่อตัวแตะ EMA 8 + MACD ยืนยัน"
    : "SIDEWAY · แตะขอบ Bollinger + RSI สุดโต่ง + แท่งกลับทิศ";
  return {
    ready: true, decisionMade: true, signal, candidateSignal: signal,
    sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch,
    targetCandleAt: new Date(targetCandleEpoch * 1000).toISOString(),
    strategy: ENGINE4_STRATEGY, analysisMode: mode,
    status: mode === "TREND_PULLBACK" ? `${regime}_${signal}` : `SIDEWAY_${signal}`,
    metrics, evidenceSummary: reason,
    alertId: `ENGINE_4:${targetCandleEpoch}:${signal}:${mode}`,
    reason: `${signal} · ${reason} · ยืนยันที่ T-5 สำหรับแท่ง M1 ถัดไป`
  };
}
