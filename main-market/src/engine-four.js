/** Engine 4: AO 5/34 with strict, ATR-normalized momentum expansion gate. */
export const ENGINE4_STRATEGY = "AWESOME_OSCILLATOR_5_34_STRONG_MOMENTUM_ATR_EXPANSION_T5_NEXT_M1";

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
function smaLast(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}
function atrLast(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const ranges = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i], previous = candles[i - 1];
    ranges.push(Math.max(current.high - current.low,
      Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

/**
 * Signal only when the latest 3 AO values stay on one side of zero,
 * absolute AO expands twice in succession, and |AO| >= 0.12 x ATR(14).
 * Otherwise return STANDBY. No percentage, score, or confidence output.
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const liveCandle = options.liveCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(liveCandle, true)) {
    return notReady("LIVE_M1_PREVIEW_NOT_READY", "Engine 4 ต้องใช้แท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  }
  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => c && c.epoch < liveCandle.epoch && validCandle(c)).slice(-60);
  const series = [...history, liveCandle];
  if (series.length < 36) {
    return notReady("INSUFFICIENT_MOMENTUM_HISTORY", "ต้องมีข้อมูล M1 อย่างน้อย 36 แท่งเพื่อยืนยันแรงส่ง AO");
  }
  const medianPrices = series.map(c => (c.high + c.low) / 2);
  const aoSeries = [];
  for (let end = 33; end < medianPrices.length; end++) {
    const sample = medianPrices.slice(0, end + 1);
    aoSeries.push(smaLast(sample, 5) - smaLast(sample, 34));
  }
  const recentAo = aoSeries.slice(-3);
  const ao = recentAo.at(-1);
  const atr14 = atrLast(series, 14);
  const zeroTolerance = 1e-12;
  if (recentAo.length !== 3 || !Number.isFinite(ao) || !Number.isFinite(atr14) || atr14 <= zeroTolerance) {
    return notReady("AO_MOMENTUM_NOT_READY", "ข้อมูล AO หรือ ATR(14) ยังไม่ครบสำหรับยืนยันแรงส่ง");
  }
  const directionSign = Math.sign(ao);
  const sameDirection = directionSign !== 0 && recentAo.every(value => Math.sign(value) === directionSign);
  const expanding = Math.abs(recentAo[2]) > Math.abs(recentAo[1]) &&
    Math.abs(recentAo[1]) > Math.abs(recentAo[0]);
  const strengthRatio = Math.abs(ao) / atr14;
  const strongEnough = strengthRatio >= 0.12;
  const metrics = {
    awesomeOscillator: ao,
    aoFastSma: smaLast(medianPrices, 5),
    aoSlowSma: smaLast(medianPrices, 34),
    aoPeriod: { fast: 5, slow: 34 },
    medianPrice: medianPrices.at(-1),
    atr14,
    aoAtrRatio: strengthRatio,
    aoExpanding: expanding,
    aoSameDirection: sameDirection,
    recentAo: recentAo.slice(),
    minimumAoAtrRatio: 0.12,
    sourceCandleEpoch: liveCandle.epoch,
    targetCandleEpoch: liveCandle.epoch + 60
  };
  const sourceCandleEpoch = liveCandle.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const signal = ao > zeroTolerance ? "CALL" : ao < -zeroTolerance ? "PUT" : null;
  if (!signal) {
    return { ...notReady("AO_ZERO_LINE", "AO อยู่ใกล้เส้นศูนย์ · ยังไม่มีทิศทางและแรงส่ง"),
      sourceCandleEpoch, targetCandleEpoch, candleEpoch: sourceCandleEpoch,
      analysisMode: "AO_STRONG_MOMENTUM", metrics, evidenceSummary: "AO ใกล้ศูนย์ · STANDBY" };
  }
  if (!sameDirection || !expanding || !strongEnough) {
    const missing = [
      !sameDirection ? "ทิศทาง AO ยังไม่ต่อเนื่อง" : null,
      !expanding ? "AO ยังไม่เร่งตัวต่อเนื่อง 2 ช่วง" : null,
      !strongEnough ? "แรง AO ยังต่ำกว่า 0.12 ATR(14)" : null
    ].filter(Boolean).join(" · ");
    return {
      ...notReady("AO_MOMENTUM_WEAK", "STANDBY · " + missing),
      sourceCandleEpoch, targetCandleEpoch, candleEpoch: sourceCandleEpoch,
      analysisMode: "AO_STRONG_MOMENTUM", metrics, evidenceSummary: missing
    };
  }
  const direction = signal === "CALL" ? "เหนือ" : "ใต้";
  const reason = "แรงส่ง AO ยืนยันแล้ว · AO " + direction + "เส้นศูนย์ (" + ao.toFixed(8) +
    ") · ขยายตัวต่อเนื่อง 2 ช่วง · แรงเทียบ ATR(14) " + strengthRatio.toFixed(2) + "x";
  return {
    ready: true, decisionMade: true, signal, candidateSignal: signal,
    sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch,
    targetCandleAt: new Date(targetCandleEpoch * 1000).toISOString(),
    strategy: ENGINE4_STRATEGY, analysisMode: "AO_STRONG_MOMENTUM",
    status: signal === "CALL" ? "AO_STRONG_CALL" : "AO_STRONG_PUT",
    metrics, evidenceSummary: reason,
    alertId: "ENGINE_4:" + targetCandleEpoch + ":" + signal + ":AO_STRONG_5_34",
    reason: signal + " · " + reason + " · ยืนยันที่ T-5 สำหรับแท่ง M1 ถัดไป"
  };
}
