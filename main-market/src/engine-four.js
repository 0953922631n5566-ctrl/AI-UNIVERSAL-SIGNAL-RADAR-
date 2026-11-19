/**
 * Engine 4 — M1 Quick Pullback EMA 2 / EMA 3.
 * Uses EMA history for trend bias and the live forming candle for pullback entry.
 * Signals immediately when the script's intrabar conditions become true in [0,23).
 */
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DISPATCH_DEADLINE_MS = 23_000;
export const ENGINE4_ENTRY_WINDOW_MS = 23_000;

function validCandle(candle) {
  return candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  let current = values[0];
  const output = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "M1_QUICK_PULLBACK_EMA2_EMA3_INTRABAR";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0 || !validCandle(live);
  if (invalid) return {
    ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"NOT_READY", reason:"Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด", strategy
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
    reason:"พ้นช่วงตรวจจับ Pullback 23 วินาทีแรกแล้ว · รอแท่ง M1 ถัดไป"
  };

  const history = candles.filter(c => c && c.provisional !== true && c.live !== true);
  if (history.length < 3 || !history.every(validCandle)) return {
    ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"INSUFFICIENT_EMA_HISTORY", candleEpoch:live.epoch, strategy,
    reason:"ต้องมีแท่ง M1 ที่ปิดแล้วอย่างน้อย 3 แท่งเพื่อคำนวณ EMA 2/3"
  };

  const closes = [...history.map(c => c.close), live.close];
  const ema2 = emaSeries(closes, 2).at(-1);
  const ema3 = emaSeries(closes, 3).at(-1);
  const uptrend = ema2 > ema3;
  const downtrend = ema2 < ema3;
  const pullbackCall = uptrend && live.low <= ema2 && live.close > live.open;
  const pullbackPut = downtrend && live.high >= ema2 && live.close < live.open;
  const direction = pullbackCall ? "CALL" : pullbackPut ? "PUT" : null;
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : live.close;
  const body = Math.abs(live.close - live.open);
  const range = Math.max(0, live.high - live.low);
  const bodyRatio = range > 0 ? body / range : 0;
  const metrics = {
    ema2, ema3, uptrend, downtrend, pullbackCall, pullbackPut,
    touchedEma2: live.low <= ema2 && live.high >= ema2,
    currentPrice, openPrice: live.open, high: live.high, low: live.low,
    bodyRatio: +bodyRatio.toFixed(3), elapsedSeconds: +(elapsed / 1000).toFixed(2),
    emaHistoryCandles: history.length, emaFastPeriod: 2, emaSlowPeriod: 3
  };

  if (!direction) {
    const reason = !uptrend && !downtrend
      ? "EMA 2 และ EMA 3 ยังทับกัน · ยังไม่มีทิศทาง"
      : uptrend
        ? "EMA 2 อยู่เหนือ EMA 3 · รอราคาย่อลงแตะ EMA 2 และราคาปัจจุบันกลับขึ้นเหนือราคาเปิด"
        : "EMA 2 อยู่ใต้ EMA 3 · รอราคาดีดขึ้นแตะ EMA 2 และราคาปัจจุบันต่ำกว่าราคาเปิด";
    return {
      ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
      candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
      status:"WAITING_FOR_PULLBACK", decisionStrength:"NONE", strategy, metrics, reason
    };
  }

  const score = Math.max(1, Math.min(100, Math.round(50 + bodyRatio * 30)));
  return {
    ready:true, signal:direction, candidateSignal:direction, score, confidence:score,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
    strategy, entryPrice:currentPrice, openPrice:live.open,
    status:direction === "CALL" ? "EMA2_3_PULLBACK_CALL" : "EMA2_3_PULLBACK_PUT",
    decisionStrength:score >= 65 ? "STRONG" : "MODERATE",
    metrics,
    evidenceSummary:direction === "CALL"
      ? "EMA 2 อยู่เหนือ EMA 3 · ราคาย่อลงแตะ EMA 2 · ราคาปัจจุบันกลับขึ้นเหนือราคาเปิด"
      : "EMA 2 อยู่ใต้ EMA 3 · ราคาดีดขึ้นแตะ EMA 2 · ราคาปัจจุบันต่ำกว่าราคาเปิด",
    alertId:`ENGINE_4:${live.epoch}:${direction}:EMA2_3_PULLBACK`,
    reason:`${direction} · ${direction === "CALL" ? "แนวโน้มขึ้น + ย่อลงแตะ EMA 2 และเริ่มดีด" : "แนวโน้มลง + ดีดขึ้นแตะ EMA 2 และเริ่มกดลง"} · พบที่วินาที ${(elapsed / 1000).toFixed(1)} ของแท่ง M1`
  };
}
