/**
 * Engine 4 — M1 Pure Price Action Pullback.
 * Reads only the live tick sequence from the current M1 candle.
 * No EMA, RSI, indicators, or previous-candle price context.
 */
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DISPATCH_DEADLINE_MS = 23_000;
export const ENGINE4_ENTRY_WINDOW_MS = 23_000;

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "M1_PURE_PRICE_ACTION_INTRABAR_PULLBACK";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0;
  if (invalid) return {
    ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"NOT_READY", reason:"Engine 4 ต้องใช้ราคา Streaming สดของแท่ง M1 ปัจจุบัน", strategy
  };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0) return {
    ready:false, signal:null, candidateSignal:null, score:0,
    status:"INVALID_CANDLE_TIME", reason:"เวลาแท่ง M1 ไม่ถูกต้อง", strategy
  };
  if (elapsed >= ENGINE4_ENTRY_WINDOW_MS) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"PULLBACK_WINDOW_CLOSED", candleEpoch:live.epoch,
    elapsedSeconds:Math.floor(elapsed / 1000), strategy,
    reason:"พ้นช่วงตรวจจับราคา 23 วินาทีแรกแล้ว · รอแท่ง M1 ถัดไป"
  };

  const ticks = options.tickStats;
  if (!ticks || ticks.candleEpoch !== live.epoch ||
      !Number.isFinite(ticks.firstPrice) || !Number.isFinite(ticks.previousPrice)) {
    return {
      ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
      status:"WAITING_FOR_PRICE_TICKS", candleEpoch:live.epoch,
      elapsedSeconds:+(elapsed / 1000).toFixed(2), strategy,
      reason:"กำลังเก็บลำดับราคาแรกของแท่ง M1"
    };
  }

  const direction = ticks.reversalSignal === "CALL" || ticks.reversalSignal === "PUT"
    ? ticks.reversalSignal : null;
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : ticks.previousPrice;
  const metrics = {
    firstPrice: ticks.firstPrice,
    initialMove: ticks.initialDirection,
    extremePrice: ticks.extremePrice,
    reversalPrice: ticks.reversalPrice ?? null,
    currentPrice,
    tickCount: ticks.totalTicks,
    elapsedSeconds: +(elapsed / 1000).toFixed(2),
    priceOnly: true,
    previousCandleUsed: false,
    indicatorsUsed: []
  };

  if (!direction) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
    status:"WAITING_FOR_PRICE_REVERSAL", decisionStrength:"NONE", strategy, metrics,
    reason: ticks.initialDirection === "UP"
      ? "ราคาเริ่มขยับขึ้น · รอราคาย่อลงครั้งแรก"
      : ticks.initialDirection === "DOWN"
        ? "ราคาเริ่มขยับลง · รอราคาดีดขึ้นครั้งแรก"
        : "รอการเคลื่อนไหวของราคาเพื่อระบุจังหวะย่อตัว"
  };

  return {
    ready:true, signal:direction, candidateSignal:direction, score:50, confidence:50,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
    strategy, entryPrice:currentPrice, status:direction === "CALL"
      ? "PRICE_ACTION_PULLBACK_CALL" : "PRICE_ACTION_PULLBACK_PUT",
    decisionStrength:"PRICE_ACTION_TRIGGER",
    metrics,
    evidenceSummary: direction === "CALL"
      ? "ราคาในแท่ง M1 ปัจจุบันขยับขึ้นก่อน แล้วเริ่มย่อลง · สวนขึ้นทันที"
      : "ราคาในแท่ง M1 ปัจจุบันขยับลงก่อน แล้วเริ่มดีดขึ้น · สวนลงทันที",
    alertId:"ENGINE_4:" + live.epoch + ":" + direction + ":PRICE_ACTION_PULLBACK",
    reason:direction + " · " + (direction === "CALL" ? "ราคาย่อลงหลังจากขยับขึ้น" : "ราคาดีดขึ้นหลังจากขยับลง") + " · พบที่วินาที " + (elapsed / 1000).toFixed(1) + " ของแท่ง M1"
  };
}
