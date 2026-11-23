/** Engine 4: MACD 12/26/9 crossover only. No scoring or additional filters. */
export const ENGINE4_STRATEGY = "MACD_12_26_9_CROSSOVER_T5_NEXT_M1";

function validCandle(c, provisional = false) {
  return c && c.live === false && (!provisional || c.provisional === true) &&
    Number.isFinite(c.epoch) &&
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low;
}
function notReady(status, reason, extra = {}) {
  return { ready: false, decisionMade: false, signal: null, candidateSignal: null,
    status, strategy: ENGINE4_STRATEGY, reason, ...extra };
}
function emaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = current;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    current = alpha * values[i] + (1 - alpha) * current;
    result[i] = current;
  }
  return result;
}
function macdSeries(closes) {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) =>
    fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]);
  const signal = Array(closes.length).fill(null);
  const validIndices = line.map((value, i) => value === null ? -1 : i).filter(i => i >= 0);
  if (validIndices.length < 9) return { line, signal };
  const seedIndices = validIndices.slice(0, 9);
  let current = seedIndices.reduce((sum, i) => sum + line[i], 0) / 9;
  const seedIndex = seedIndices.at(-1);
  signal[seedIndex] = current;
  const alpha = 2 / (9 + 1);
  for (let i = seedIndex + 1; i < line.length; i++) {
    if (line[i] === null) continue;
    current = alpha * line[i] + (1 - alpha) * current;
    signal[i] = current;
  }
  return { line, signal };
}

/**
 * Use standard close-based MACD: EMA(12)-EMA(26), signal EMA(9).
 * CALL only on MACD crossing above its signal line; PUT only on crossing below.
 * The live M1 candle is compared with the previous closed M1 candle so a crossover
 * occurring during the current candle remains detectable at the T-5 dispatch window.
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const liveCandle = options.liveCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(liveCandle, true)) {
    return notReady("LIVE_M1_PREVIEW_NOT_READY", "Engine 4 ต้องใช้แท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  }
  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => c && c.epoch < liveCandle.epoch && validCandle(c)).slice(-80);
  const series = [...history, liveCandle];
  if (series.length < 35) {
    return notReady("INSUFFICIENT_MACD_HISTORY", "ต้องมีข้อมูล M1 อย่างน้อย 35 แท่งเพื่อคำนวณ MACD 12/26/9");
  }
  const { line, signal } = macdSeries(series.map(c => c.close));
  const index = series.length - 1;
  const previousMacd = line[index - 1], previousSignal = signal[index - 1];
  const currentMacd = line[index], currentSignal = signal[index];
  if (![previousMacd, previousSignal, currentMacd, currentSignal].every(Number.isFinite)) {
    return notReady("MACD_NOT_READY", "ข้อมูล MACD 12/26/9 ยังไม่ครบ");
  }
  const crossedUp = previousMacd <= previousSignal && currentMacd > currentSignal;
  const crossedDown = previousMacd >= previousSignal && currentMacd < currentSignal;
  const sourceCandleEpoch = liveCandle.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const metrics = {
    macdLine: currentMacd,
    signalLine: currentSignal,
    histogram: currentMacd - currentSignal,
    previousMacdLine: previousMacd,
    previousSignalLine: previousSignal,
    periods: { fast: 12, slow: 26, signal: 9 },
    sourceCandleEpoch,
    targetCandleEpoch
  };
  if (!crossedUp && !crossedDown) {
    return {
      ...notReady("MACD_NO_CROSS", "MACD ยังไม่ตัดเส้น Signal · STANDBY"),
      sourceCandleEpoch, targetCandleEpoch, candleEpoch: sourceCandleEpoch,
      analysisMode: "MACD_12_26_9_CROSSOVER", metrics,
      evidenceSummary: "รอ MACD ตัดเส้น Signal"
    };
  }
  const signalName = crossedUp ? "CALL" : "PUT";
  const reason = crossedUp
    ? "MACD 12/26 ตัดขึ้นเหนือเส้น Signal 9"
    : "MACD 12/26 ตัดลงใต้เส้น Signal 9";
  return {
    ready: true, decisionMade: true, signal: signalName, candidateSignal: signalName,
    sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch,
    targetCandleAt: new Date(targetCandleEpoch * 1000).toISOString(),
    strategy: ENGINE4_STRATEGY, analysisMode: "MACD_12_26_9_CROSSOVER",
    status: crossedUp ? "MACD_BULLISH_CROSS" : "MACD_BEARISH_CROSS",
    metrics, evidenceSummary: reason,
    alertId: "ENGINE_4:" + targetCandleEpoch + ":" + signalName + ":MACD_12_26_9",
    reason: signalName + " · " + reason + " · ยืนยันที่ T-5 สำหรับแท่ง M1 ถัดไป"
  };
}
