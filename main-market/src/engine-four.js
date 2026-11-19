/**
 * Engine 4 collects live EUR/USD tick direction from M1 open through second 24.
 * At second 25 it confirms the tick majority with the candle's open-to-current
 * price displacement. Both sources must point in the same direction.
 */
export const ENGINE4_MIN_PRICE_MOVE = 0.00001; // 0.1 pip on EUR/USD (five-decimal quote)

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "ENGINE_4_M1_PRICE_DISPLACEMENT_AND_TICK_MAJORITY_AT_25S";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0 ||
    !Number.isFinite(live.open) || !Number.isFinite(live.close);
  if (invalid) return { ready:false, signal:null, candidateSignal:null, score:0, status:"NOT_READY",
    reason:"Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด", strategy };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0 || elapsed >= 60_000) return {
    ready:true, signal:null, candidateSignal:null, score:0, status:"DECISION_WINDOW_CLOSED",
    candleEpoch:live.epoch, elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)), strategy,
    reason:"พ้นช่วงตัดสินใจของแท่ง M1 นี้"
  };

  const stats = options.tickStats;
  const validStats = stats && stats.candleEpoch === live.epoch &&
    Number.isFinite(stats.upTicks) && Number.isFinite(stats.downTicks);
  const upTicks = validStats ? Math.max(0, Math.floor(stats.upTicks)) : 0;
  const downTicks = validStats ? Math.max(0, Math.floor(stats.downTicks)) : 0;
  const directionalTicks = upTicks + downTicks;
  const totalTicks = validStats ? Math.max(directionalTicks, Math.floor(stats.totalTicks || 0)) : 0;
  const decisionPrice = validStats && Number.isFinite(stats.decisionPrice) ? stats.decisionPrice : null;
  const priceDelta = decisionPrice === null ? null : decisionPrice - live.open;
  const priceMovePips = priceDelta === null ? null : priceDelta / 0.0001;
  const priceDirection = priceDelta !== null && Math.abs(priceDelta) >= ENGINE4_MIN_PRICE_MOVE
    ? priceDelta > 0 ? "CALL" : "PUT" : null;
  const tickDirection = upTicks === downTicks ? null : upTicks > downTicks ? "CALL" : "PUT";
  const base = { ready:true, signal:null, candidateSignal:null, score:0,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
    entryPrice:decisionPrice, openPrice:live.open,
    metrics:{upTicks,downTicks,directionalTicks,totalTicks,netTicks:upTicks-downTicks,
      upShare:directionalTicks ? +(upTicks/directionalTicks*100).toFixed(1) : null,
      downShare:directionalTicks ? +(downTicks/directionalTicks*100).toFixed(1) : null,
      openPrice:live.open,currentPrice:decisionPrice,priceDelta,
      priceMovePips:priceMovePips === null ? null : +priceMovePips.toFixed(2),priceDirection,tickDirection,
      decisionElapsedSeconds:validStats && Number.isFinite(stats.decisionElapsedSeconds) ? stats.decisionElapsedSeconds : null} };

  if (elapsed < 25_000) return {...base,status:"COLLECTING_FIRST_25_SECONDS",
    reason:"กำลังเก็บระยะราคาเปิดถึงราคาปัจจุบันและจำนวน Tick · ตัดสินใจเมื่อครบ 25 วินาที"};
  if (!validStats) return {...base,status:"TICK_STATS_UNAVAILABLE",reason:"ไม่มีข้อมูล Tick ของแท่ง M1 ปัจจุบัน · ไม่ส่งสัญญาณ"};
  if (decisionPrice === null) return {...base,status:"WAITING_FOR_DECISION_PRICE",reason:"ครบวินาทีที่ 25 แล้ว · รอ Tick แรกเพื่อบันทึกราคาเข้า ณ จุดตัดสินใจ"};
  if (!validStats || !directionalTicks || !tickDirection) return {...base,status:"TICK_COUNT_TIED",
    reason:"ครบ 25 วินาทีแล้ว · Tick ขึ้น/ลงไม่แสดงฝั่งชัดเจน · ไม่ส่งสัญญาณ"};
  if (!priceDirection) return {...base,status:"PRICE_MOVE_TOO_SMALL",
    reason:`ครบ 25 วินาทีแล้ว · ราคาเปิด ${live.open} กับราคาตัดสินใจ ${decisionPrice} เคลื่อนที่น้อยกว่า 0.1 pip · ไม่ส่งสัญญาณ`};
  if (priceDirection !== tickDirection) return {...base,status:"PRICE_TICK_CONFLICT",
    reason:`ครบ 25 วินาทีแล้ว · ราคา ณ จุดตัดสินใจเคลื่อนทาง ${priceDirection} แต่ Tick ส่วนใหญ่อยู่ทาง ${tickDirection} · ไม่ส่งสัญญาณ`};

  const signal = priceDirection;
  const majority = Math.max(upTicks,downTicks);
  const score = Math.round(majority/directionalTicks*100);
  return {...base,signal,candidateSignal:signal,score,
    status:signal === "CALL" ? "PRICE_AND_TICKS_CALL" : "PRICE_AND_TICKS_PUT",
    alertId:`ENGINE_4:${live.epoch}:${signal}:PRICE_AND_TICKS_AT_25S`,
    reason:signal === "CALL"
      ? `ราคาเปิด ${live.open} → ราคาเข้า ${decisionPrice} (+${priceMovePips.toFixed(2)} pip) · Tick ขึ้น ${upTicks} มากกว่า Tick ลง ${downTicks} · CALL`
      : `ราคาเปิด ${live.open} → ราคาเข้า ${decisionPrice} (${priceMovePips.toFixed(2)} pip) · Tick ลง ${downTicks} มากกว่า Tick ขึ้น ${upTicks} · PUT`};
}
