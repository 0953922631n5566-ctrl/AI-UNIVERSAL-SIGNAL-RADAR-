/**
 * Engine 4 collects the complete first 23 seconds of the current M1 candle,
 * then emits exactly one directional signal before the 30-second entry cutoff.
 * The direction is a weighted intrabar estimate, not a calibrated probability.
 */
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DISPATCH_DEADLINE_MS = 30_000;
export const ENGINE4_ENTRY_WINDOW_MS = ENGINE4_DISPATCH_DEADLINE_MS;

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const signDirection = value => value > 0 ? "CALL" : value < 0 ? "PUT" : null;

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "ENGINE_4_FIRST_23S_WEIGHTED_DIRECTION_NO_SYNTHETIC_FALLBACK";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0 ||
    !Number.isFinite(live.open) || !Number.isFinite(live.close) ||
    !Number.isFinite(live.high) || !Number.isFinite(live.low) ||
    live.high < Math.max(live.open, live.close) ||
    live.low > Math.min(live.open, live.close) || live.high < live.low;
  if (invalid) return { ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"NOT_READY", reason:"Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด", strategy };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < ENGINE4_COLLECTION_WINDOW_MS) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"COLLECTING_FIRST_23_SECONDS", candleEpoch:live.epoch,
    elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)), strategy,
    reason:"กำลังเก็บราคาและแรง Tick ตั้งแต่ต้นแท่ง M1 · จะตัดสินใจเมื่อครบ 23 วินาที"
  };
  if (elapsed >= ENGINE4_DISPATCH_DEADLINE_MS) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"ENTRY_DEADLINE_MISSED", candleEpoch:live.epoch,
    elapsedSeconds:Math.floor(elapsed/1000), strategy,
    reason:"พ้นเส้นตายส่งสัญญาณ 30 วินาทีของแท่งนี้แล้ว · รอแท่งถัดไป"
  };

  const stats = options.tickStats;
  const validStats = stats && stats.candleEpoch === live.epoch &&
    Number.isFinite(stats.upTicks) && Number.isFinite(stats.downTicks);
  if (!validStats) return {
    ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"TICK_STATS_UNAVAILABLE", candleEpoch:live.epoch, strategy,
    reason:"ไม่มีสถิติ Tick ของแท่ง M1 นี้ · ไม่สร้างสัญญาณจากข้อมูลที่ไม่ครบ"
  };

  const upTicks = Math.max(0, Math.floor(stats.upTicks));
  const downTicks = Math.max(0, Math.floor(stats.downTicks));
  const directionalTicks = upTicks + downTicks;
  const totalTicks = Math.max(directionalTicks, Math.floor(stats.totalTicks || 0));
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : live.close;
  const symbol = String(options.symbol || "").toUpperCase();
  const pipSize = symbol.includes("JPY") ? 0.01 : 0.0001;
  const range = Math.max(0, live.high - live.low);
  const priceDelta = currentPrice - live.open;
  const priceMovePips = priceDelta / pipSize;
  const tickImbalance = directionalTicks ? (upTicks - downTicks) / directionalTicks : 0;
  const displacement = range > 0 ? clamp(priceDelta / range) : Math.sign(priceDelta);
  const bodyStrength = range > 0 ? clamp((live.close - live.open) / range) : Math.sign(priceDelta);
  const closeLocation = range > 0 ? clamp(((live.close - live.low) / range) * 2 - 1) : Math.sign(priceDelta);

  // Weight the complete candle-to-now displacement and tick pressure most heavily.
  const composite = (0.40 * displacement) + (0.35 * tickImbalance) +
    (0.15 * bodyStrength) + (0.10 * closeLocation);
  const direction = composite > 0 ? "CALL" : composite < 0 ? "PUT" :
    signDirection(priceDelta) || (upTicks !== downTicks ? (upTicks > downTicks ? "CALL" : "PUT") : null);
  if (!direction) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed/1000), strategy,
    entryPrice:currentPrice, openPrice:live.open,
    status:"NO_DIRECTIONAL_EDGE", decisionStrength:"NONE",
    metrics:{ upTicks, downTicks, directionalTicks, totalTicks, netTicks:upTicks-downTicks,
      compositeScore:+composite.toFixed(4), openPrice:live.open, currentPrice, priceDelta,
      priceMovePips:+priceMovePips.toFixed(2), rangeHigh:live.high, rangeLow:live.low, pipSize },
    evidenceSummary:`เก็บข้อมูล 23 วินาทีแล้ว แต่ราคาและ Tick ยังไม่มีทิศทางที่แยกได้`,
    reason:"หลักฐานในแท่งปัจจุบันไม่ชี้ขึ้นหรือลงอย่างมีทิศทาง · ไม่สุ่มสร้าง CALL/PUT"
  };

  const directionalConfidence = Math.round(Math.abs(composite) * 100);
  const tickShare = directionalTicks ? Math.max(upTicks, downTicks) / directionalTicks : 0;
  const evidenceSummary = `เก็บข้อมูล 1–23 วินาที · เปิด ${live.open} → ล่าสุด ${currentPrice} (${priceMovePips >= 0 ? "+" : ""}${priceMovePips.toFixed(2)} pip) · ช่วงราคา ${live.low}–${live.high} · Tick ขึ้น ${upTicks}/ลง ${downTicks}`;
  const weakEvidence = directionalTicks === 0 || Math.abs(composite) < 0.15;
  return {
    ready:true, signal:direction, candidateSignal:direction, score:directionalConfidence,
    confidence:directionalConfidence, candleEpoch:live.epoch,
    elapsedSeconds:Math.floor(elapsed/1000), strategy,
    entryPrice:currentPrice, openPrice:live.open, evidenceSummary,
    status:direction === "CALL" ? "M1_23S_CALL" : "M1_23S_PUT",
    decisionStrength:weakEvidence ? "LOW" : directionalConfidence >= 55 ? "STRONG" : "MODERATE",
    metrics:{
      upTicks,downTicks,directionalTicks,totalTicks,netTicks:upTicks-downTicks,
      upShare:directionalTicks ? +(upTicks/directionalTicks*100).toFixed(1) : null,
      downShare:directionalTicks ? +(downTicks/directionalTicks*100).toFixed(1) : null,
      directionalConfidencePct:directionalTicks ? +(tickShare*100).toFixed(1) : null,
      compositeScore:+composite.toFixed(4), directionalConfidencePctComposite:directionalConfidence,
      openPrice:live.open,currentPrice,priceDelta,priceMovePips:+priceMovePips.toFixed(2),
      rangeHigh:live.high,rangeLow:live.low,rangePosition:range ? +((live.close-live.low)/range).toFixed(4) : null,
      pipSize
    },
    alertId:`ENGINE_4:${live.epoch}:${direction}:FIRST_23_SECONDS`,
    reason:`${evidenceSummary} · ${direction} · ${weakEvidence ? "หลักฐานมีน้ำหนักต่ำ แต่ทิศทางที่ตรวจพบยังเอนเอียง" : "ตัดสินจากคะแนนถ่วงน้ำหนัก"} · ส่งสัญญาณที่วินาที 23 ก่อนเส้นตาย 30 วินาที`
  };
}
