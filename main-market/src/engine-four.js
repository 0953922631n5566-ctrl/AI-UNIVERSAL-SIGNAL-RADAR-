/**
 * Engine 4: Twelve Data EMA(5) pullback-and-rebound trigger.
 * EMA values come from Twelve Data /ema; this module never calculates EMA.
 */
export const ENGINE4_STRATEGY = "TWELVE_DATA_EMA5_PULLBACK_BOUNCE_IMMEDIATE";
export const ENGINE4_PULLBACK_PROXIMITY_PIPS = 0.5;
export const ENGINE4_BOUNCE_CONFIRM_PIPS = 0.2;
const MAX_TICK_AGE_MS = 5000;
const MAX_EMA_AGE_MS = 120000;

function notReady(status, reason, nextState = null, metrics = null) {
  return { ready: false, decisionMade: false, signal: null, candidateSignal: null,
    status, strategy: ENGINE4_STRATEGY, reason, nextState, metrics };
}
function pipSize(symbol) {
  return String(symbol || "").toUpperCase().replace("/", "").endsWith("JPY") ? 0.01 : 0.0001;
}
function validEmaPoint(point) {
  return point && Number.isFinite(point.epoch) && Number.isFinite(point.ema) && point.ema > 0;
}

export function analyzeEarlyEntryEngine4({
  emaValues, livePrice, tickAt, now = Date.now(), symbol = "EUR/USD",
  sourceCandleEpoch = Math.floor(now / 60000) * 60, state = null
} = {}) {
  if (!Array.isArray(emaValues) || emaValues.length < 2 ||
      !emaValues.slice(-2).every(validEmaPoint) ||
      emaValues.at(-1).epoch - emaValues.at(-2).epoch !== 60) {
    return notReady("EMA5_API_NOT_READY", "รอค่า EMA 5 สองแท่ง M1 ที่ปิดแล้วจาก Twelve Data");
  }
  const [previous, latest] = emaValues.slice(-2);
  const emaAge = now - (latest.epoch + 60) * 1000;
  if (!Number.isFinite(emaAge) || emaAge < -5000 || emaAge > MAX_EMA_AGE_MS) {
    return notReady("EMA5_API_STALE", "ค่า EMA 5 จาก Twelve Data เก่าเกินกำหนด");
  }
  if (!Number.isFinite(livePrice) || livePrice <= 0 ||
      !Number.isFinite(tickAt) || tickAt > now || now - tickAt > MAX_TICK_AGE_MS) {
    return notReady("LIVE_PRICE_STALE", "รอราคา Twelve Data Streaming สดเพื่อจับจังหวะเด้ง");
  }

  const slope = latest.ema - previous.ema;
  if (slope === 0) return notReady("EMA5_SLOPE_FLAT", "EMA 5 ไม่เอียงขึ้นหรือลง · STANDBY");
  const direction = slope > 0 ? "CALL" : "PUT";
  const pip = pipSize(symbol);
  const proximity = pip * ENGINE4_PULLBACK_PROXIMITY_PIPS;
  const bounce = pip * ENGINE4_BOUNCE_CONFIRM_PIPS;
  const sameTrend = state?.direction === direction;
  let nextState = sameTrend ? { ...state, emaEpoch: latest.epoch } : {
    direction, emaEpoch: latest.epoch, phase: "WAIT_TREND_SIDE",
    extremePrice: null, triggeredCandleEpoch: null
  };

  if (nextState.triggeredCandleEpoch === sourceCandleEpoch) {
    return notReady("EMA5_ALREADY_TRIGGERED_THIS_CANDLE",
      "เครื่องยนต์ตัวที่ 4 ส่งสัญญาณแล้วในแท่ง M1 นี้ · รอแท่งถัดไป", nextState);
  }
  if (nextState.phase === "TRIGGERED") {
    nextState.phase = direction === "CALL"
      ? (livePrice > latest.ema + proximity ? "WAIT_PULLBACK" : "WAIT_TREND_SIDE")
      : (livePrice < latest.ema - proximity ? "WAIT_PULLBACK" : "WAIT_TREND_SIDE");
    nextState.extremePrice = null;
  }
  if (nextState.phase === "WAIT_TREND_SIDE") {
    const onTrendSide = direction === "CALL"
      ? livePrice >= latest.ema + proximity
      : livePrice <= latest.ema - proximity;
    if (onTrendSide) nextState.phase = "WAIT_PULLBACK";
  }
  if (nextState.phase === "WAIT_PULLBACK") {
    const reachedPullbackZone = direction === "CALL"
      ? livePrice <= latest.ema + proximity
      : livePrice >= latest.ema - proximity;
    if (reachedPullbackZone) {
      nextState.phase = "WAIT_REBOUND";
      nextState.extremePrice = livePrice;
    }
  }
  if (nextState.phase === "WAIT_REBOUND") {
    nextState.extremePrice = direction === "CALL"
      ? Math.min(nextState.extremePrice, livePrice)
      : Math.max(nextState.extremePrice, livePrice);
    const reboundDistance = direction === "CALL"
      ? livePrice - nextState.extremePrice : nextState.extremePrice - livePrice;
    const reclaimed = direction === "CALL" ? livePrice > latest.ema : livePrice < latest.ema;
    const metrics = {
      ema5: latest.ema, previousEma5: previous.ema, ema5Slope: slope, livePrice,
      pullbackPhase: nextState.phase,
      distanceToEmaPips: Number((Math.abs(livePrice - latest.ema) / pip).toFixed(3)),
      reboundPips: Number((reboundDistance / pip).toFixed(3)),
      proximityThresholdPips: ENGINE4_PULLBACK_PROXIMITY_PIPS,
      bounceConfirmPips: ENGINE4_BOUNCE_CONFIRM_PIPS,
      emaSource: "TWELVE_DATA_EMA_ENDPOINT"
    };
    if (reclaimed && reboundDistance >= bounce) {
      nextState.phase = "TRIGGERED";
      nextState.triggeredCandleEpoch = sourceCandleEpoch;
      const reason = direction === "CALL"
        ? "EMA 5 ชี้ขึ้น · ราคาย่อลงเข้าใกล้เส้นแล้วเด้งกลับขึ้นเหนือ EMA 5 · CALL ทันที"
        : "EMA 5 ชี้ลง · ราคาดีดขึ้นเข้าใกล้เส้นแล้วกลับลงใต้ EMA 5 · PUT ทันที";
      return {
        ready: true, decisionMade: true, signal: direction, candidateSignal: direction,
        sourceCandleEpoch, candleEpoch: sourceCandleEpoch, targetCandleEpoch: sourceCandleEpoch,
        targetCandleAt: new Date(sourceCandleEpoch * 1000).toISOString(),
        entryPrice: livePrice, entryPriceBasis: "TWELVE_DATA_STREAM_PULLBACK_BOUNCE_PRICE",
        strategy: ENGINE4_STRATEGY, analysisMode: ENGINE4_STRATEGY,
        status: direction === "CALL" ? "EMA5_PULLBACK_BOUNCE_CALL" : "EMA5_PULLBACK_BOUNCE_PUT",
        trigger: "EMA5_PULLBACK_BOUNCE", metrics: { ...metrics, pullbackPhase: "TRIGGERED" },
        nextState, evidenceSummary: reason,
        alertId: "ENGINE_4:" + sourceCandleEpoch + ":" + direction + ":EMA5_PULLBACK_BOUNCE",
        reason
      };
    }
    return notReady("EMA5_WAITING_FOR_REBOUND",
      "ราคาเข้าเขตย่อใกล้ EMA 5 แล้ว · รอราคาเด้งกลับยืนยัน", nextState, metrics);
  }
  return notReady(nextState.phase === "WAIT_PULLBACK"
    ? "EMA5_WAITING_FOR_PULLBACK" : "EMA5_WAITING_FOR_TREND_SIDE",
    direction === "CALL"
      ? "EMA 5 ชี้ขึ้น · รอราคาย่อลงเข้าใกล้เส้น EMA 5"
      : "EMA 5 ชี้ลง · รอราคาดีดขึ้นเข้าใกล้เส้น EMA 5",
    nextState, {
      ema5: latest.ema, previousEma5: previous.ema, ema5Slope: slope, livePrice,
      pullbackPhase: nextState.phase, proximityThresholdPips: ENGINE4_PULLBACK_PROXIMITY_PIPS,
      bounceConfirmPips: ENGINE4_BOUNCE_CONFIRM_PIPS, emaSource: "TWELVE_DATA_EMA_ENDPOINT"
    });
}
