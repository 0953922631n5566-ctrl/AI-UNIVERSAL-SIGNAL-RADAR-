/**
 * Engine 4 — M1 Quick Pullback Helper (EMA 5 / EMA 13).
 * Detects a live pullback/rejection as soon as it forms during seconds [0,23)
 * of the current M1 candle. This is a manual-entry signal, never a broker order.
 */
export const ENGINE4_COLLECTION_WINDOW_MS = 23_000;
export const ENGINE4_DISPATCH_DEADLINE_MS = 23_000;
export const ENGINE4_ENTRY_WINDOW_MS = 23_000;

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

function validCandle(candle) {
  return candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;
}

export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const live = Array.isArray(candles) ? candles.at(-1) : null;
  const strategy = "M1_QUICK_PULLBACK_EMA5_EMA13_INTRABAR";
  const invalid = !options.livePreview || !live ||
    live.live !== true && live.provisional !== true ||
    !Number.isFinite(live.epoch) || live.epoch < 0 || !validCandle(live);
  if (invalid) return { ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"NOT_READY", reason:"Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด", strategy };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0) return { ready:false, signal:null, candidateSignal:null, score:0,
    status:"INVALID_CANDLE_TIME", reason:"เวลาแท่ง M1 ไม่ถูกต้อง", strategy };
  if (elapsed >= ENGINE4_ENTRY_WINDOW_MS) return {
    ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"PULLBACK_WINDOW_CLOSED", candleEpoch:live.epoch,
    elapsedSeconds:Math.floor(elapsed / 1000), strategy,
    reason:"พ้นช่วงตรวจจับ 23 วินาทีแรกแล้ว · รอแท่ง M1 ถัดไป"
  };

  const history = candles.filter(c => c && c.provisional !== true && c.live !== true);
  if (history.length < 13 || !history.every(validCandle)) return {
    ready:false, signal:null, candidateSignal:null, score:0, confidence:0,
    status:"INSUFFICIENT_EMA_HISTORY", candleEpoch:live.epoch, strategy,
    reason:"ต้องมีแท่ง M1 ปิดที่ถูกต้องอย่างน้อย 13 แท่งเพื่อคำนวณ EMA 13"
  };

  // Calculate EMA values from closed history plus the current forming candle.
  const closes = [...history.map(c => c.close), live.close];
  const ema5Series = emaSeries(closes, 5);
  const ema13Series = emaSeries(closes, 13);
  const ema5 = ema5Series.at(-1);
  const ema13 = ema13Series.at(-1);
  const uptrend = ema5 > ema13;
  const downtrend = ema5 < ema13;
  // Touch-only entry: do not wait for a bullish/bearish candle-body confirmation.
  // The live candle low/high records the intrabar pullback/retest of EMA 5.
  const pullbackCall = uptrend && live.low <= ema5;
  const pullbackPut = downtrend && live.high >= ema5;
  const direction = pullbackCall ? "CALL" : pullbackPut ? "PUT" : null;
  const currentPrice = Number.isFinite(options.currentPrice) ? options.currentPrice : live.close;
  const trendGapPct = ema13 !== 0 ? Math.abs((ema5 - ema13) / ema13) * 100 : 0;
  const body = Math.abs(live.close - live.open);
  const range = Math.max(0, live.high - live.low);
  const bodyRatio = range > 0 ? body / range : 0;
  const score = Math.max(1, Math.min(100, Math.round(50 + trendGapPct * 1000 + bodyRatio * 20)));
  const metrics = {
    ema5, ema13, uptrend, downtrend, pullbackCall, pullbackPut,
    touchedEma5: live.low <= ema5 && live.high >= ema5,
    currentPrice, openPrice: live.open, high: live.high, low: live.low,
    bodyRatio: +bodyRatio.toFixed(3), elapsedSeconds: +(elapsed / 1000).toFixed(2),
    emaHistoryCandles: history.length
  };
  if (!direction) {
    const reason = !uptrend && !downtrend
      ? "EMA 5 และ EMA 13 ยังทับกัน · ยังไม่มีแนวโน้มชัดเจน"
      : uptrend
        ? "แนวโน้มขึ้น แต่ยังไม่พบราคาย่อลงแตะ EMA 5 พร้อมแท่งเริ่มดีดขึ้น"
        : "แนวโน้มลง แต่ยังไม่พบราคาดีดขึ้นแตะ EMA 5 พร้อมแท่งเริ่มกดลง";
    return { ready:true, signal:null, candidateSignal:null, score:0, confidence:0,
      candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
      status:"WAITING_FOR_PULLBACK", decisionStrength:"NONE", strategy, metrics,
      reason };
  }

  return {
    ready:true, signal:direction, candidateSignal:direction, score, confidence:score,
    candleEpoch:live.epoch, elapsedSeconds:Math.floor(elapsed / 1000),
    strategy, entryPrice:currentPrice, openPrice:live.open,
    status:direction === "CALL" ? "EMA5_13_PULLBACK_CALL" : "EMA5_13_PULLBACK_PUT",
    decisionStrength:score >= 65 ? "STRONG" : "MODERATE",
    metrics,
    evidenceSummary:direction === "CALL"
      ? "EMA 5 อยู่เหนือ EMA 13 · ราคาย่อลงแตะ EMA 5 · ส่งสัญญาณทันทีโดยไม่รอสีแท่ง"
      : "EMA 5 อยู่ใต้ EMA 13 · ราคาดีดขึ้นแตะ EMA 5 · ส่งสัญญาณทันทีโดยไม่รอสีแท่ง",
    alertId:`ENGINE_4:${live.epoch}:${direction}:EMA5_13_PULLBACK`,
    reason:`${direction} · ${direction === "CALL" ? "ขาขึ้น + ราคาย่อลงแตะ EMA 5" : "ขาลง + ราคาดีดขึ้นแตะ EMA 5"} · พบที่วินาที ${(elapsed / 1000).toFixed(1)} ของแท่ง M1`
  };
}
