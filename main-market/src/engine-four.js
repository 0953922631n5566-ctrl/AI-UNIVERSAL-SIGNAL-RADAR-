/**
 * Engine 4 collects live EUR/USD tick direction from M1 open through second 24.
 * It makes exactly one decision at second 25 (35 seconds remaining).
 */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "ENGINE_4_M1_TICK_DIRECTION_MAJORITY_AT_25S";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0;
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
  const base = { ready:true, signal:null, candidateSignal:null, score:0,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
    metrics:{upTicks,downTicks,directionalTicks,totalTicks,netTicks:upTicks-downTicks,
      upShare:directionalTicks ? +(upTicks/directionalTicks*100).toFixed(1) : null,
      downShare:directionalTicks ? +(downTicks/directionalTicks*100).toFixed(1) : null} };

  if (elapsed < 25_000) return {...base,status:"COLLECTING_FIRST_25_SECONDS",
    reason:"กำลังเก็บ Tick ตั้งแต่ต้นแท่ง M1 · จะตัดสินใจเมื่อครบ 25 วินาที"};
  if (!validStats || upTicks === downTicks) return {...base,status:"TICK_COUNT_TIED",
    reason:directionalTicks ? "ครบ 25 วินาทีแล้ว · จำนวน Tick ขึ้นและลงเท่ากัน · ไม่ส่งสัญญาณ"
      : "ครบ 25 วินาทีแล้ว · ไม่มี Tick ที่แสดงทิศทาง · ไม่ส่งสัญญาณ"};

  const signal = upTicks > downTicks ? "CALL" : "PUT";
  const majority = Math.max(upTicks,downTicks);
  const score = directionalTicks ? Math.round(majority/directionalTicks*100) : 0;
  return {...base,signal,candidateSignal:signal,score,
    status:signal === "CALL" ? "TICK_MAJORITY_CALL" : "TICK_MAJORITY_PUT",
    alertId:`ENGINE_4:${live.epoch}:${signal}:TICK_MAJORITY_AT_25S`,
    reason:signal === "CALL" ? `ครบ 25 วินาที · Tick ขึ้น ${upTicks} ครั้ง มากกว่า Tick ลง ${downTicks} ครั้ง`
      : `ครบ 25 วินาที · Tick ลง ${downTicks} ครั้ง มากกว่า Tick ขึ้น ${upTicks} ครั้ง`};
}
