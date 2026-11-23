/** Engine 4: MACD 12/26/9 with adaptive historical proximity. No scoring or extra indicators. */
export const ENGINE4_STRATEGY = "MACD_12_26_9_ADAPTIVE_HISTORICAL_PROXIMITY_T5_NEXT_M1";
const HISTORY_WINDOW = 40;
const PROXIMITY_PERCENTILE = 25;
const MIN_PROXIMITY_SAMPLES = 40;

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
function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * percent / 100;
  const lower = Math.floor(position), upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * MACD histogram distance is compared with its own trailing historical distribution.
 * A negative, historically-close gap gives CALL; a positive, historically-close gap
 * gives PUT. A real crossover remains an immediate directional trigger.
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const liveCandle = options.liveCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(liveCandle, true)) {
    return notReady("LIVE_M1_PREVIEW_NOT_READY", "Engine 4 ต้องใช้แท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  }
  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => c && c.epoch < liveCandle.epoch && validCandle(c)).slice(-80);
  const series = [...history, liveCandle];
  if (series.length < 74) {
    return notReady("INSUFFICIENT_MACD_HISTORY",
      "ต้องมีข้อมูล M1 อย่างน้อย 73 แท่งปิด + แท่งปัจจุบัน เพื่อวัดระยะ MACD จากสถิติย้อนหลัง");
  }
  const { line, signal } = macdSeries(series.map(c => c.close));
  const index = series.length - 1;
  const previousMacd = line[index - 1], previousSignal = signal[index - 1];
  const currentMacd = line[index], currentSignal = signal[index];
  if (![previousMacd, previousSignal, currentMacd, currentSignal].every(Number.isFinite)) {
    return notReady("MACD_NOT_READY", "ข้อมูล MACD 12/26/9 ยังไม่ครบ");
  }
  const historicalGaps = [];
  for (let i = Math.max(0, index - HISTORY_WINDOW); i < index; i++) {
    if (Number.isFinite(line[i]) && Number.isFinite(signal[i])) {
      historicalGaps.push(Math.abs(line[i] - signal[i]));
    }
  }
  if (historicalGaps.length < MIN_PROXIMITY_SAMPLES) {
    return notReady("INSUFFICIENT_MACD_STATISTICS",
      "ข้อมูลสถิติระยะห่าง MACD ย้อนหลังยังไม่ครบ 40 ตัวอย่าง",
      { historicalSamples: historicalGaps.length });
  }
  const historicalThreshold = percentile(historicalGaps, PROXIMITY_PERCENTILE);
  const currentGap = currentMacd - currentSignal;
  const absoluteGap = Math.abs(currentGap);
  const crossedUp = previousMacd <= previousSignal && currentMacd > currentSignal;
  const crossedDown = previousMacd >= previousSignal && currentMacd < currentSignal;
  const nearFromBelow = currentGap < 0 && absoluteGap <= historicalThreshold;
  const nearFromAbove = currentGap > 0 && absoluteGap <= historicalThreshold;
  const crossed = crossedUp || crossedDown;
  const near = nearFromBelow || nearFromAbove;
  const sourceCandleEpoch = liveCandle.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const metrics = {
    macdLine: currentMacd,
    signalLine: currentSignal,
    histogram: currentGap,
    previousMacdLine: previousMacd,
    previousSignalLine: previousSignal,
    absoluteGap,
    historicalProximityThreshold: historicalThreshold,
    historicalPercentile: PROXIMITY_PERCENTILE,
    historicalSamples: historicalGaps.length,
    historyWindow: HISTORY_WINDOW,
    periods: { fast: 12, slow: 26, signal: 9 },
    sourceCandleEpoch,
    targetCandleEpoch
  };
  if (!crossed && !near) {
    return {
      ...notReady("MACD_NOT_NEAR_SIGNAL",
        "MACD ยังห่างจากเส้น Signal เมื่อเทียบกับสถิติย้อนหลัง · STANDBY"),
      sourceCandleEpoch, targetCandleEpoch, candleEpoch: sourceCandleEpoch,
      analysisMode: "MACD_12_26_9_ADAPTIVE_HISTORICAL_PROXIMITY", metrics,
      evidenceSummary: "รอ MACD เข้าใกล้ Signal ตามระยะอ้างอิงจากสถิติย้อนหลัง"
    };
  }
  const signalName = crossed ? (crossedUp ? "CALL" : "PUT")
    : nearFromBelow ? "CALL" : "PUT";
  const trigger = crossed ? "CROSSOVER" : "HISTORICAL_PROXIMITY";
  const reason = crossed
    ? (crossedUp ? "MACD ตัดขึ้นเหนือเส้น Signal" : "MACD ตัดลงใต้เส้น Signal")
    : (nearFromBelow
      ? "MACD อยู่ใต้เส้น Signal และเข้าใกล้ในระยะ 25% แรกของสถิติย้อนหลัง"
      : "MACD อยู่เหนือเส้น Signal และเข้าใกล้ในระยะ 25% แรกของสถิติย้อนหลัง");
  return {
    ready: true, decisionMade: true, signal: signalName, candidateSignal: signalName,
    sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch,
    targetCandleAt: new Date(targetCandleEpoch * 1000).toISOString(),
    strategy: ENGINE4_STRATEGY,
    analysisMode: "MACD_12_26_9_ADAPTIVE_HISTORICAL_PROXIMITY",
    status: trigger === "CROSSOVER"
      ? (crossedUp ? "MACD_BULLISH_CROSS" : "MACD_BEARISH_CROSS")
      : (nearFromBelow ? "MACD_APPROACHING_FROM_BELOW" : "MACD_APPROACHING_FROM_ABOVE"),
    trigger, metrics, evidenceSummary: reason,
    alertId: "ENGINE_4:" + targetCandleEpoch + ":" + signalName + ":" + trigger,
    reason: signalName + " · " + reason + " · ยืนยันที่ T-5 สำหรับแท่ง M1 ถัดไป"
  };
}
