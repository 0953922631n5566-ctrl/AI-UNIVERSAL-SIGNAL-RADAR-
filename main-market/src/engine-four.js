/**
 * Engine 4 — two closed M1 candle bodies plus the live M1 tick path.
 * At second 23, dispatch in the direction with the greater accumulated movement.
 * The final five-second movement is reported as continuation context only;
 * it never overrides the accumulated direction.
 */
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DECISION_AT_MS = 23_000;
export const ENGINE4_ENTRY_WINDOW_MS = 60_000;

function validCandle(candle) {
  return candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;
}

function notReady(status, reason, extra = {}) {
  return {
    ready: false, decisionMade: false, signal: null, candidateSignal: null,
    score: 0, confidence: 0, status, strategy: "M1_TWO_CLOSED_PLUS_LIVE_23S_ACCUMULATED_PRESSURE",
    reason, ...extra
  };
}

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "M1_TWO_CLOSED_PLUS_LIVE_23S_ACCUMULATED_PRESSURE";
  if (!options.livePreview || !live ||
      (live.live !== true && live.provisional !== true) ||
      !Number.isFinite(live.epoch) || live.epoch < 0 || !validCandle(live)) {
    return notReady("NOT_READY", "Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด");
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0) return notReady("INVALID_CANDLE_TIME", "เวลาแท่ง M1 ไม่ถูกต้อง");
  if (elapsed < ENGINE4_DECISION_AT_MS) {
    return {
      ready: true, decisionMade: false, signal: null, candidateSignal: null,
      score: 0, confidence: 0, status: "COLLECTING_PRICE_PRESSURE",
      candleEpoch: live.epoch, elapsedSeconds: +(elapsed / 1000).toFixed(2),
      strategy, reason: "กำลังเก็บแรงขึ้น–ลงจากแท่งปิด 2 แท่งและแท่งปัจจุบัน · ตัดสินใจเมื่อครบ 23 วินาที"
    };
  }
  if (elapsed >= ENGINE4_ENTRY_WINDOW_MS) {
    return {
      ready: true, decisionMade: false, signal: null, candidateSignal: null,
      score: 0, confidence: 0, status: "DECISION_WINDOW_CLOSED",
      candleEpoch: live.epoch, elapsedSeconds: Math.floor(elapsed / 1000),
      strategy, reason: "พ้นช่วงตัดสินใจของแท่ง M1 นี้แล้ว · รอแท่งถัดไป"
    };
  }

  const closed = candles.filter(c => c && c !== live && c.live !== true && c.provisional !== true);
  const lastTwoClosed = closed.slice(-2);
  if (lastTwoClosed.length !== 2 || !lastTwoClosed.every(validCandle)) {
    return notReady("INSUFFICIENT_CLOSED_CANDLES", "ต้องมีแท่ง M1 ที่ปิดแล้ว 2 แท่งเพื่อคำนวณแรงสะสม", {
      candleEpoch: live.epoch, elapsedSeconds: Math.floor(elapsed / 1000)
    });
  }

  const tickStats = options.tickStats;
  if (!tickStats || tickStats.candleEpoch !== live.epoch ||
      !Number.isFinite(tickStats.upMovement) || !Number.isFinite(tickStats.downMovement) ||
      tickStats.upMovement < 0 || tickStats.downMovement < 0 || tickStats.totalTicks < 1) {
    return notReady("LIVE_TICK_PATH_NOT_READY", "ยังเก็บเส้นทางราคา Streaming ของแท่งปัจจุบันไม่ครบ", {
      candleEpoch: live.epoch, elapsedSeconds: Math.floor(elapsed / 1000)
    });
  }

  // Closed candles provide reliable net body displacement (OHLC does not preserve
  // the exact historical tick sequence). The live candle contributes every up/down
  // tick-to-tick price change collected from its open through second 23.
  const closedUpMovement = lastTwoClosed.reduce((sum, candle) =>
    sum + Math.max(0, candle.close - candle.open), 0);
  const closedDownMovement = lastTwoClosed.reduce((sum, candle) =>
    sum + Math.max(0, candle.open - candle.close), 0);
  const liveUpMovement = tickStats.upMovement;
  const liveDownMovement = tickStats.downMovement;
  const totalUpMovement = closedUpMovement + liveUpMovement;
  const totalDownMovement = closedDownMovement + liveDownMovement;
  const difference = totalUpMovement - totalDownMovement;
  const tieTolerance = Math.max(1e-12, (totalUpMovement + totalDownMovement) * 1e-9);
  const direction = difference > tieTolerance ? "CALL"
    : difference < -tieTolerance ? "PUT" : null;

  const recentSamples = Array.isArray(tickStats.recentSamples)
    ? tickStats.recentSamples.filter(sample => sample &&
      Number.isFinite(sample.at) && Number.isFinite(sample.price) &&
      sample.at <= now && sample.at >= now - 5_000)
    : [];
  let continuationDirection = "UNKNOWN";
  let recentNetMovement = null;
  if (recentSamples.length >= 2) {
    recentNetMovement = recentSamples.at(-1).price - recentSamples[0].price;
    continuationDirection = recentNetMovement > 0 ? "UP"
      : recentNetMovement < 0 ? "DOWN" : "FLAT";
  }
  const dominantDirection = direction === "CALL" ? "UP" : direction === "PUT" ? "DOWN" : "TIE";
  const continuationSupportsDominant = direction && continuationDirection !== "UNKNOWN"
    ? (direction === "CALL" ? continuationDirection === "UP" : continuationDirection === "DOWN")
    : null;
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : live.close;
  const totalMovement = totalUpMovement + totalDownMovement;
  const score = direction
    ? Math.max(1, Math.min(100, Math.round(50 + 50 * Math.abs(difference) / Math.max(totalMovement, tieTolerance))))
    : 0;
  const metrics = {
    closedCandlesUsed: lastTwoClosed.map(c => c.epoch),
    closedUpMovement, closedDownMovement,
    liveUpMovement, liveDownMovement,
    totalUpMovement, totalDownMovement,
    netMovement: difference,
    dominantDirection,
    continuationWindowSeconds: 5,
    continuationDirection,
    recentNetMovement,
    continuationSupportsDominant,
    continuationPolicy: "OBSERVE_ONLY_DO_NOT_OVERRIDE_ACCUMULATED_DIRECTION",
    currentPrice, liveOpen: live.open,
    liveTickCount: tickStats.totalTicks,
    liveSamplesInContinuationWindow: recentSamples.length,
    elapsedSeconds: +(elapsed / 1000).toFixed(2)
  };

  if (!direction) {
    return {
      ready: true, decisionMade: true, signal: null, candidateSignal: null,
      score: 0, confidence: 0, candleEpoch: live.epoch,
      elapsedSeconds: Math.floor(elapsed / 1000), strategy,
      status: "ACCUMULATED_PRESSURE_TIE", decisionStrength: "NONE", metrics,
      reason: "แรงขึ้นสะสมและแรงลงสะสมเท่ากัน · ไม่มีทิศทางที่มากกว่า จึงไม่ออกสัญญาณ"
    };
  }

  const continuationText = continuationDirection === "UNKNOWN"
    ? "ยังไม่มีข้อมูลช่วงท้าย 5 วินาทีเพียงพอ"
    : continuationSupportsDominant
      ? "แรงช่วงท้าย 5 วินาทีสนับสนุนทิศทางเดียวกัน"
      : "แรงช่วงท้าย 5 วินาทีสวนทาง แต่ไม่เปลี่ยนทิศทางแรงสะสมหลัก";
  const sideText = direction === "CALL" ? "แรงขึ้นสะสมมากกว่า" : "แรงลงสะสมมากกว่า";
  return {
    ready: true, decisionMade: true, signal: direction, candidateSignal: direction,
    score, confidence: score, candleEpoch: live.epoch,
    elapsedSeconds: Math.floor(elapsed / 1000), strategy,
    entryPrice: currentPrice, entryPriceBasis: "TWO_CLOSED_M1_BODY_PLUS_LIVE_M1_TICK_PATH_AT_23S",
    status: direction === "CALL" ? "ACCUMULATED_PRESSURE_CALL" : "ACCUMULATED_PRESSURE_PUT",
    decisionStrength: score >= 75 ? "STRONG" : score >= 60 ? "MODERATE" : "LIGHT",
    metrics,
    evidenceSummary: `${sideText} · เปรียบเทียบแรงสะสม 2 แท่งปิดกับเส้นทางราคาแท่งปัจจุบัน · ${continuationText}`,
    alertId: `ENGINE_4:${live.epoch}:${direction}:ACCUMULATED_PRESSURE_23S`,
    reason: `${direction} · ${sideText} · ตัดสินใจที่วินาที 23 · ${continuationText}`
  };
}
