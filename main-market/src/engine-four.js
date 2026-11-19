/**
 * Engine 4 analyzes only the latest forming M1 candle in real time.
 * It compares current-price displacement from the candle open with live-tick
 * direction and dominance collected inside this same candle.
 */
export const ENGINE4_MIN_PRICE_MOVE = 0.00001; // 0.1 pip on EUR/USD
export const ENGINE4_MIN_DIRECTIONAL_TICKS = 3;
export const ENGINE4_MIN_TICK_SHARE = 0.60;

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "ENGINE_4_LIVE_SINGLE_CANDLE_PRICE_TICK_PROBABILITY";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0 ||
    !Number.isFinite(live.open) || !Number.isFinite(live.close);
  if (invalid) return { ready:false, signal:null, candidateSignal:null, score:0, status:"NOT_READY",
    reason:"Engine 4 ต้องใช้แท่ง M1 ล่าสุดที่กำลังวิ่งและราคา Streaming สด", strategy };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0 || elapsed >= 60_000) return {
    ready:true, signal:null, candidateSignal:null, score:0, status:"CANDLE_WINDOW_CLOSED",
    candleEpoch:live.epoch, elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)), strategy,
    reason:"แท่ง M1 ปัจจุบันหมดเวลาแล้ว"
  };

  const stats = options.tickStats;
  const validStats = stats && stats.candleEpoch === live.epoch &&
    Number.isFinite(stats.upTicks) && Number.isFinite(stats.downTicks);
  const upTicks = validStats ? Math.max(0, Math.floor(stats.upTicks)) : 0;
  const downTicks = validStats ? Math.max(0, Math.floor(stats.downTicks)) : 0;
  const directionalTicks = upTicks + downTicks;
  const totalTicks = validStats ? Math.max(directionalTicks, Math.floor(stats.totalTicks || 0)) : 0;
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : live.close;
  const priceDelta = currentPrice - live.open;
  const priceMovePips = priceDelta / 0.0001;
  const priceDirection = Math.abs(priceDelta) >= ENGINE4_MIN_PRICE_MOVE
    ? priceDelta > 0 ? "CALL" : "PUT" : null;
  const tickDirection = upTicks === downTicks ? null : upTicks > downTicks ? "CALL" : "PUT";
  const tickShare = directionalTicks ? Math.max(upTicks, downTicks) / directionalTicks : 0;
  const score = Math.round(tickShare * 100);
  const evidenceSummary = `ราคาเปิด ${live.open} → ราคาปัจจุบัน ${currentPrice} (${priceMovePips >= 0 ? "+" : ""}${priceMovePips.toFixed(2)} pip) · Tick ขึ้น ${upTicks} / ลง ${downTicks} · ความเอนเอียงของ Tick ${score}%`;
  const base = { ready:true, signal:null, candidateSignal:null, score:validStats ? score : 0,
    confidence:validStats ? score : 0, candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
    entryPrice:currentPrice, openPrice:live.open, evidenceSummary,
    metrics:{upTicks,downTicks,directionalTicks,totalTicks,netTicks:upTicks-downTicks,
      upShare:directionalTicks ? +(upTicks/directionalTicks*100).toFixed(1) : null,
      downShare:directionalTicks ? +(downTicks/directionalTicks*100).toFixed(1) : null,
      directionalConfidencePct:directionalTicks ? +(tickShare*100).toFixed(1) : null,
      minimumDirectionalTicks:ENGINE4_MIN_DIRECTIONAL_TICKS,
      minimumTickSharePct:ENGINE4_MIN_TICK_SHARE*100,
      openPrice:live.open,currentPrice,priceDelta,
      priceMovePips:+priceMovePips.toFixed(2),priceDirection,tickDirection} };

  if (!validStats) return {...base,status:"TICK_STATS_UNAVAILABLE",
    reason:`${evidenceSummary} · ยังไม่มีข้อมูล Tick ของแท่ง M1 ล่าสุด`};
  if (directionalTicks < ENGINE4_MIN_DIRECTIONAL_TICKS) return {...base,status:"COLLECTING_LIVE_TICKS",
    reason:`${evidenceSummary} · กำลังประเมินแท่งปัจจุบัน · Tick ที่มีทิศทาง ${directionalTicks}/${ENGINE4_MIN_DIRECTIONAL_TICKS}`};
  if (!tickDirection) return {...base,status:"TICK_COUNT_TIED",
    reason:`${evidenceSummary} · Tick ขึ้นและลงเท่ากัน · ยังไม่เห็นทิศทางที่ได้เปรียบ`};
  if (!priceDirection) return {...base,status:"PRICE_MOVE_TOO_SMALL",
    reason:`${evidenceSummary} · ราคาเคลื่อนที่น้อยกว่า 0.1 pip`};
  if (tickShare < ENGINE4_MIN_TICK_SHARE) return {...base,status:"TICK_MAJORITY_TOO_WEAK",
    reason:`${evidenceSummary} · Tick ฝั่งที่มากกว่าต้องมีอย่างน้อย ${ENGINE4_MIN_TICK_SHARE*100}%`};
  if (priceDirection !== tickDirection) return {...base,status:"PRICE_TICK_CONFLICT",
    reason:`${evidenceSummary} · ราคาปัจจุบันชี้ไปทาง ${priceDirection} แต่ Tick ส่วนใหญ่อยู่ทาง ${tickDirection}`};

  const signal = priceDirection;
  return {...base,signal,candidateSignal:signal,score,confidence:score,
    status:signal === "CALL" ? "LIVE_PRICE_AND_TICKS_CALL" : "LIVE_PRICE_AND_TICKS_PUT",
    alertId:`ENGINE_4:${live.epoch}:${signal}:LIVE_SINGLE_CANDLE`,
    reason:signal === "CALL"
      ? `${evidenceSummary} · CALL`
      : `${evidenceSummary} · PUT`};
}
