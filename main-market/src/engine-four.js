/** Engine 4: Awesome Oscillator (SMA 5 - SMA 34) only. */
export const ENGINE4_STRATEGY = "AWESOME_OSCILLATOR_5_34_ZERO_LINE_NEXT_M1_OPEN";

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

function smaLast(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Standard Awesome Oscillator:
 * median price = (high + low) / 2
 * AO = SMA(median, 5) - SMA(median, 34)
 * AO > 0 => CALL; AO < 0 => PUT; AO === 0 => no directional signal.
 * No trend regime, RSI, MACD, Bollinger, EMA, candle pattern, or score is used.
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const liveCandle = options.liveCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(liveCandle, true)) {
    return notReady("LIVE_M1_PREVIEW_NOT_READY",
      "Engine 4 ต้องใช้แท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  }

  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => c && c.epoch < liveCandle.epoch && validCandle(c))
    .slice(-60);
  const series = [...history, liveCandle];
  if (series.length < 34) {
    return notReady("INSUFFICIENT_HISTORY", "Awesome Oscillator 5/34 ต้องมีข้อมูล M1 อย่างน้อย 34 แท่ง");
  }

  const medianPrices = series.map(c => (c.high + c.low) / 2);
  const fastSma = smaLast(medianPrices, 5);
  const slowSma = smaLast(medianPrices, 34);
  if (![fastSma, slowSma].every(Number.isFinite)) {
    return notReady("AO_NOT_READY", "ข้อมูล Awesome Oscillator 5/34 ยังไม่ครบ");
  }

  const ao = fastSma - slowSma;
  // Ignore floating-point residue at the zero line; this is numeric precision, not a market filter.
  const zeroTolerance = 1e-12;
  const signal = ao > zeroTolerance ? "CALL" : ao < -zeroTolerance ? "PUT" : null;
  const sourceCandleEpoch = liveCandle.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const metrics = {
    awesomeOscillator: ao,
    aoFastSma: fastSma,
    aoSlowSma: slowSma,
    aoPeriod: { fast: 5, slow: 34 },
    medianPrice: medianPrices.at(-1),
    sourceCandleEpoch,
    targetCandleEpoch
  };

  if (!signal) {
    return {
      ...notReady("AO_ZERO_LINE", "Awesome Oscillator อยู่ที่เส้นศูนย์ — ยังไม่เลือกทิศทาง"),
      sourceCandleEpoch, targetCandleEpoch, candleEpoch: sourceCandleEpoch,
      analysisMode: "AO_ZERO_LINE", metrics,
      evidenceSummary: "AO = 0 · ไม่มีทิศทาง"
    };
  }

  const direction = signal === "CALL" ? "เหนือเส้นศูนย์" : "ใต้เส้นศูนย์";
  const reason = `Awesome Oscillator 5/34 อยู่${direction} (AO ${ao.toFixed(8)})`;
  return {
    ready: true, decisionMade: true, signal, candidateSignal: signal,
    sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch,
    targetCandleAt: new Date(targetCandleEpoch * 1000).toISOString(),
    strategy: ENGINE4_STRATEGY, analysisMode: "AO_ZERO_LINE",
    status: signal === "CALL" ? "AO_POSITIVE_CALL" : "AO_NEGATIVE_PUT",
    metrics, evidenceSummary: reason,
    alertId: `ENGINE_4:${targetCandleEpoch}:${signal}:AO_5_34`,
    reason: `${signal} · ${reason} · ส่งสัญญาณใน 5 วินาทีแรกของแท่ง M1 ถัดไป`
  };
}
