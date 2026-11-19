/**
 * Engine 4 M1 tick-direction majority.
 * Counts each live EUR/USD price tick relative to the immediately preceding
 * tick in the same M1 candle, only during seconds 0-24. Equal-price ticks do
 * not contribute. A directional majority creates one candidate for that M1.
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "ENGINE_4_M1_TICK_DIRECTION_MAJORITY";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0;
  if (invalid) {
    return { ready:false, signal:null, candidateSignal:null, score:0, status:"NOT_READY",
      reason:"Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด", strategy };
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0 || elapsed >= 25000) {
    return { ready:true, signal:null, candidateSignal:null, score:0, status:"ENTRY_WINDOW_CLOSED",
      candleEpoch:live.epoch, elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)), strategy,
      reason:"หมดช่วงนับ Tick ใน 25 วินาทีแรกของแท่ง M1" };
  }

  const stats = options.tickStats;
  const validStats = stats && stats.candleEpoch === live.epoch &&
    Number.isFinite(stats.upTicks) && Number.isFinite(stats.downTicks);
  if (!validStats) {
    return { ready:true, signal:null, candidateSignal:null, score:0, status:"WAITING_FOR_TICKS",
      candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
      metrics:{upTicks:0,downTicks:0,directionalTicks:0,totalTicks:0},
      reason:"กำลังรวบรวม Tick ราคาในแท่ง M1 ปัจจุบัน" };
  }

  const upTicks = Math.max(0, Math.floor(stats.upTicks));
  const downTicks = Math.max(0, Math.floor(stats.downTicks));
  const directionalTicks = upTicks + downTicks;
  const totalTicks = Math.max(directionalTicks, Math.floor(stats.totalTicks || 0));
  const base = {
    ready:true, signal:null, candidateSignal:null, score:0,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
    metrics:{upTicks,downTicks,directionalTicks,totalTicks,
      netTicks:upTicks-downTicks,
      upShare:directionalTicks ? +(upTicks/directionalTicks*100).toFixed(1) : null,
      downShare:directionalTicks ? +(downTicks/directionalTicks*100).toFixed(1) : null}
  };
  if (upTicks === downTicks) {
    return {...base,status:"TICK_COUNT_TIED",
      reason:directionalTicks ? "จำนวน Tick ขึ้นและลงเท่ากัน · รอต่อ" : "กำลังรวบรวม Tick ราคา · ยังไม่มีการเคลื่อนที่สุทธิ"};
  }

  const signal = upTicks > downTicks ? "CALL" : "PUT";
  const majority = Math.max(upTicks,downTicks);
  const score = directionalTicks ? Math.round(majority/directionalTicks*100) : 0;
  return {
    ...base, signal, candidateSignal:signal, score,
    status:signal === "CALL" ? "TICK_MAJORITY_CALL" : "TICK_MAJORITY_PUT",
    alertId:`ENGINE_4:${live.epoch}:${signal}:TICK_MAJORITY`,
    reason:signal === "CALL"
      ? `CALL · Tick ขึ้น ${upTicks} ครั้ง มากกว่า Tick ลง ${downTicks} ครั้ง`
      : `PUT · Tick ลง ${downTicks} ครั้ง มากกว่า Tick ขึ้น ${upTicks} ครั้ง`
  };
}
