function valid(c) {
  return c && [c.epoch,c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    c.epoch >= 0 && c.low > 0 && c.high >= Math.max(c.open,c.close) &&
    c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}

/**
 * Engine 4 adaptive two-candle entry:
 * Uses exactly the last closed M1 candle and the current forming M1 candle.
 * The seven evidence groups are reduced to observable two-candle facts;
 * no older candle history, EMA, or long-period ATR is used.
 */
export function analyzeEarlyEntryEngine4(candles, options={}) {
  const rows = Array.isArray(candles) ? candles.slice(-2) : [];
  const previous = rows.at(-2);
  const live = rows.at(-1);
  const strategy = "ENGINE_4_ADAPTIVE_TWO_CANDLE_LIVE_ENTRY";
  const invalid = !options.livePreview || rows.length !== 2 || !valid(previous) ||
    previous.live === true || !valid(live) ||
    (live.live !== true && live.provisional !== true);
  if (invalid) {
    return {ready:false,signal:null,candidateSignal:null,score:0,status:"NOT_READY",
      reason:"Engine 4 ต้องใช้แท่ง M1 ที่ปิดแล้ว 1 แท่ง และแท่ง M1 ปัจจุบันที่กำลังวิ่ง",strategy};
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now - live.epoch * 1000;
  if (elapsed < 0 || elapsed >= 25000) {
    return {ready:true,signal:null,candidateSignal:null,score:0,status:"ENTRY_WINDOW_CLOSED",
      candleEpoch:live.epoch,elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)),strategy,
      reason:"หมดช่วงเข้าออเดอร์ 25 วินาทีแรกของแท่ง M1 ปัจจุบัน"};
  }

  const previousRange = Math.max(previous.high-previous.low, Number.EPSILON);
  const range = Math.max(live.high-live.low, Number.EPSILON);
  const body = live.close-live.open;
  const bodyRatio = Math.abs(body)/range;
  const previousBodyRatio = Math.abs(previous.close-previous.open)/previousRange;
  const closePosition = (live.close-live.low)/range;
  const upperWick = (live.high-Math.max(live.open,live.close))/range;
  const lowerWick = (Math.min(live.open,live.close)-live.low)/range;
  const rangeRatio = range/previousRange;

  // 1) Two-candle structure and 2) previous-candle high/low reaction.
  const brokeAbove = live.high > previous.high;
  const brokeBelow = live.low < previous.low;
  const falseBreakUp = brokeAbove && live.close < previous.high && upperWick >= 0.22;
  const falseBreakDown = brokeBelow && live.close > previous.low && lowerWick >= 0.22;
  const supportBounce = live.low <= previous.low + previousRange*0.18 &&
    body > 0 && closePosition >= 0.62 && lowerWick >= 0.18;
  const resistanceReject = live.high >= previous.high - previousRange*0.18 &&
    body < 0 && closePosition <= 0.38 && upperWick >= 0.18;

  // 3) Momentum, 4) candle psychology, and 5) volatility.
  const bullishMomentum = body > 0 && live.close > previous.close;
  const bearishMomentum = body < 0 && live.close < previous.close;
  const bullishCandleConfirm = bullishMomentum && closePosition >= 0.60 && bodyRatio >= 0.18;
  const bearishCandleConfirm = bearishMomentum && closePosition <= 0.40 && bodyRatio >= 0.18;
  const abnormalRange = rangeRatio > 2.5;
  const lowActivity = rangeRatio < 0.12;

  // 6) Liquidity sweep/fakeout, 7) adaptive two-candle market regime.
  const callReversal = supportBounce || falseBreakDown;
  const putReversal = resistanceReject || falseBreakUp;
  const callContinuation = previous.close > previous.open && bullishMomentum &&
    live.close > previous.close && closePosition >= 0.68;
  const putContinuation = previous.close < previous.open && bearishMomentum &&
    live.close < previous.close && closePosition <= 0.32;
  const directional = callContinuation || putContinuation;
  const reversal = callReversal || putReversal;
  const choppy = !directional && !reversal ||
    (previousBodyRatio < 0.18 && bodyRatio < 0.18);
  const regime = choppy ? "TWO_CANDLE_CHOP" :
    reversal ? "TWO_CANDLE_REVERSAL" : "MICRO_TREND_CONTINUATION";
  const requiredScore = choppy ? 70 : reversal ? 55 : 60;

  const normalVolatility = !abnormalRange && !lowActivity;
  const callScore = Math.min(100,
    15*Number(live.close > previous.close || falseBreakDown) +
    25*Number(callReversal) +
    20*Number(bullishMomentum) +
    15*Number(bullishCandleConfirm) +
    10*Number(lowerWick >= 0.18) +
    10*Number(normalVolatility) +
    5*Number(previous.close >= previous.open));
  const putScore = Math.min(100,
    15*Number(live.close < previous.close || falseBreakUp) +
    25*Number(putReversal) +
    20*Number(bearishMomentum) +
    15*Number(bearishCandleConfirm) +
    10*Number(upperWick >= 0.18) +
    10*Number(normalVolatility) +
    5*Number(previous.close <= previous.open));
  const score = Math.max(callScore,putScore);
  const base = {
    ready:true,signal:null,candidateSignal:null,score,scoreUp:callScore,scoreDown:putScore,
    candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),
    targetCandleAt:new Date(live.epoch*1000).toISOString(),strategy,regime,
    metrics:{
      candlesUsed:2,previousCandleClosed:true,currentCandleLive:true,
      previousRange,liveRange:range,rangeRatio:+rangeRatio.toFixed(3),
      previousBodyRatio:+previousBodyRatio.toFixed(3),bodyRatio:+bodyRatio.toFixed(3),
      closeLocation:+closePosition.toFixed(3),upperWickRatio:+upperWick.toFixed(3),
      lowerWickRatio:+lowerWick.toFixed(3),brokeAbovePreviousHigh:brokeAbove,
      brokeBelowPreviousLow:brokeBelow,falseBreakUp,falseBreakDown,
      supportBounce,resistanceReject,bullishMomentum,bearishMomentum,
      callContinuation,putContinuation,requiredScore
    },
    evidence:[
      "โครงสร้าง: เปรียบเทียบแท่งปิดล่าสุดกับแท่งที่กำลังวิ่ง",
      falseBreakDown ? "กวาด Low แล้วปิดกลับเหนือ Low เดิม" :
        falseBreakUp ? "กวาด High แล้วปิดกลับใต้ High เดิม" :
        supportBounce ? "ทดสอบ Low เดิมแล้วมีแรงซื้อปฏิเสธราคา" :
        resistanceReject ? "ทดสอบ High เดิมแล้วมีแรงขายปฏิเสธราคา" :
        "ยังไม่พบการปฏิเสธแนว High/Low ที่ชัดเจน",
      bullishMomentum ? "โมเมนตัมปัจจุบันเอนขึ้น" :
        bearishMomentum ? "โมเมนตัมปัจจุบันเอนลง" : "โมเมนตัมยังไม่ชัด",
      abnormalRange ? "ช่วงราคากว้างผิดปกติ" :
        lowActivity ? "ช่วงราคาแคบเกินไป/กิจกรรมต่ำ" : "ช่วงราคาไม่ผิดปกติ",
      regime === "TWO_CANDLE_CHOP" ? "สองแท่งยังไม่ยืนยันทิศทาง งดไล่ราคา" :
        regime === "TWO_CANDLE_REVERSAL" ? "พบหลักฐานการกลับตัวระยะสั้น" :
        "พบแรงต่อเนื่องระยะสั้น"
    ]
  };

  if (abnormalRange) return {...base,status:"ABNORMAL_RANGE_BLOCK",
    reason:"แท่งปัจจุบันมีช่วงราคากว้างกว่าแท่งก่อนเกิน 2.5 เท่า · งดเข้า"};
  if (lowActivity) return {...base,status:"LOW_ACTIVITY_WAIT",
    reason:"แท่งปัจจุบันยังเคลื่อนไหวน้อยเกินไป · รอหลักฐานเพิ่ม"};
  if (callScore >= requiredScore && callScore-putScore >= 8 &&
      (callReversal || callContinuation)) {
    const status = falseBreakDown ? "TWO_CANDLE_FALSE_BREAKDOWN_CALL" :
      supportBounce ? "TWO_CANDLE_SUPPORT_BOUNCE_CALL" : "TWO_CANDLE_CONTINUATION_CALL";
    return {...base,signal:"CALL",candidateSignal:"CALL",score:callScore,status,
      alertId:`ENGINE_4:${live.epoch}:CALL:${status}`,
      reason:falseBreakDown ? "CALL · กวาด Low แล้วราคากลับมายืนเหนือ Low เดิม" :
        supportBounce ? "CALL · ทดสอบ Low เดิมแล้วแท่งสดยืนยันแรงซื้อกลับ" :
        "CALL · แท่งปิดและแท่งสดยืนยันโมเมนตัมขึ้น"};
  }
  if (putScore >= requiredScore && putScore-callScore >= 8 &&
      (putReversal || putContinuation)) {
    const status = falseBreakUp ? "TWO_CANDLE_FALSE_BREAKUP_PUT" :
      resistanceReject ? "TWO_CANDLE_RESISTANCE_REJECT_PUT" : "TWO_CANDLE_CONTINUATION_PUT";
    return {...base,signal:"PUT",candidateSignal:"PUT",score:putScore,status,
      alertId:`ENGINE_4:${live.epoch}:PUT:${status}`,
      reason:falseBreakUp ? "PUT · กวาด High แล้วราคากลับลงใต้ High เดิม" :
        resistanceReject ? "PUT · ทดสอบ High เดิมแล้วแท่งสดยืนยันแรงขายกลับ" :
        "PUT · แท่งปิดและแท่งสดยืนยันโมเมนตัมลง"};
  }
  return {...base,status:"TWO_CANDLE_WAIT",
    reason:choppy ? "สองแท่งยังไม่แสดงความได้เปรียบชัดเจน · รอจังหวะ" :
      "พบหลักฐานบางส่วน แต่คะแนนหรือความต่างของทิศทางยังไม่ผ่านเกณฑ์"};
}
