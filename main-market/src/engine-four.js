const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
function valid(c) {
  return c && [c.epoch,c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    c.epoch >= 0 && c.low > 0 && c.high >= Math.max(c.open,c.close) &&
    c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function atr(rows, period = 14) {
  const tr = rows.slice(1).map((c,i)=>Math.max(c.high-c.low,
    Math.abs(c.high-rows[i].close),Math.abs(c.low-rows[i].close)));
  return mean(tr.slice(-period));
}
/** Engine 4: independent pressure/rejection/structure entry on the live M1 candle, seconds 0-29 only. */
export function analyzeEarlyEntryEngine4(candles, options = {}) {
  const minimum = Number.isInteger(options.minimumClosedCandles) ? options.minimumClosedCandles : 35;
  const rows = Array.isArray(candles) ? candles.slice(-55) : [];
  const live = rows.at(-1), closed = rows.slice(0,-1);
  if (options.livePreview !== true || !live || (live.live !== true && live.provisional !== true) || !valid(live) ||
      closed.length < minimum || !closed.every(c=>c.live!==true && valid(c))) {
    return {ready:false,signal:null,candidateSignal:null,score:0,status:"NOT_READY",
      reason:`Engine 4 ต้องมีแท่งปิดอย่างน้อย ${minimum} แท่งและแท่ง M1 ปัจจุบันที่กำลังก่อตัว`,
      strategy:"ENGINE_4_EARLY_PRESSURE_REJECTION_STRUCTURE_0_30S"};
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const elapsed = now-live.epoch*1000;
  if (elapsed < 0 || elapsed >= 30000) return {ready:true,signal:null,candidateSignal:null,
    score:0,status:"ENTRY_WINDOW_CLOSED",candleEpoch:live.epoch,
    elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)),
    strategy:"ENGINE_4_EARLY_PRESSURE_REJECTION_STRUCTURE_0_30S",
    reason:"Engine 4 เปิดจังหวะเข้าเฉพาะ 30 วินาทีแรกของแท่ง M1"};
  const history=closed.slice(-50), prev=history.at(-1), volatility=atr(history);
  if (!(volatility>0)) return {ready:true,signal:null,candidateSignal:null,score:0,
    status:"VOLATILITY_NOT_READY",candleEpoch:live.epoch,
    strategy:"ENGINE_4_EARLY_PRESSURE_REJECTION_STRUCTURE_0_30S",
    reason:"ข้อมูล ATR ยังไม่พร้อมสำหรับประเมินแรงราคา"};
  const range=Math.max(live.high-live.low,Number.EPSILON), body=live.close-live.open;
  const bodyRatio=Math.abs(body)/range, closePos=(live.close-live.low)/range;
  const upper=(live.high-Math.max(live.open,live.close))/range;
  const lower=(Math.min(live.open,live.close)-live.low)/range;
  const displacement=Math.abs(body)/volatility, recent=history.slice(-6);
  const priorHigh=Math.max(...recent.map(c=>c.high)), priorLow=Math.min(...recent.map(c=>c.low));
  const breakUp=live.close>priorHigh, breakDown=live.close<priorLow;
  const buyPressure=body>0&&bodyRatio>=.35&&closePos>=.68;
  const sellPressure=body<0&&bodyRatio>=.35&&closePos<=.32;
  const buyReject=lower>=.38&&closePos>=.58, sellReject=upper>=.38&&closePos<=.42;
  const buyMomentum=live.close>prev.close&&live.close>=live.open&&(live.close-prev.close)/volatility>=.08;
  const sellMomentum=live.close<prev.close&&live.close<=live.open&&(prev.close-live.close)/volatility>=.08;
  const upContext=history.slice(-5).filter((c,i,a)=>i>0&&c.close>=a[i-1].close).length>=2;
  const downContext=history.slice(-5).filter((c,i,a)=>i>0&&c.close<=a[i-1].close).length>=2;
  const up=Math.round(30*Number(buyPressure||buyReject)+25*Number(buyMomentum)+
    20*Number(buyReject)+15*Number(breakUp||(live.low<=priorLow&&closePos>=.7))+10*Number(upContext));
  const down=Math.round(30*Number(sellPressure||sellReject)+25*Number(sellMomentum)+
    20*Number(sellReject)+15*Number(breakDown||(live.high>=priorHigh&&closePos<=.3))+10*Number(downContext));
  const abnormal=range>volatility*2.2, stretched=displacement>.9, quiet=range<volatility*.06;
  const score=Math.max(up,down);
  const base={ready:true,signal:null,candidateSignal:null,score,scoreUp:up,scoreDown:down,
    candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),
    targetCandleAt:new Date(live.epoch*1000).toISOString(),
    strategy:"ENGINE_4_EARLY_PRESSURE_REJECTION_STRUCTURE_0_30S",
    regime:buyMomentum?"EARLY_BUY_PRESSURE":sellMomentum?"EARLY_SELL_PRESSURE":"UNCLEAR",
    metrics:{atr:volatility,rangeAtr:+(range/volatility).toFixed(3),bodyRatio:+bodyRatio.toFixed(3),
      closeLocation:+closePos.toFixed(3),upperWickRatio:+upper.toFixed(3),lowerWickRatio:+lower.toFixed(3),
      displacementAtr:+displacement.toFixed(3),priorHigh,priorLow},
    evidence:[buyPressure||sellPressure?"พบแรงซื้อ/แรงขายจากลำตัวและตำแหน่งปิดแท่ง":"แรงจากลำตัวแท่งยังไม่ชัด",
      buyReject||sellReject?"พบไส้เทียนปฏิเสธราคา":"ยังไม่พบไส้เทียนปฏิเสธราคาที่ชัด",
      breakUp||breakDown?"ราคาทะลุกรอบ high/low ระยะสั้น":"ยังไม่ยืนยันการทะลุกรอบระยะสั้น",
      abnormal?"งดสัญญาณ: ช่วงราคาเกิน 2.2 ATR":stretched?"งดสัญญาณ: ราคาเคลื่อนจากจุดเปิดเกิน 0.9 ATR":quiet?"งดสัญญาณ: ช่วงราคาแคบเกินไป":"ผ่านตัวกรองความผันผวน"]};
  if(abnormal)return {...base,status:"ABNORMAL_RANGE_BLOCK",reason:"แท่ง M1 ผันผวนผิดปกติ · งดเข้า"};
  if(stretched)return {...base,status:"LATE_MOVE_BLOCK",reason:"ราคาเคลื่อนจากจุดเปิดไกลเกินไป · ไม่ไล่ตามราคา"};
  if(quiet)return {...base,status:"LOW_ACTIVITY_BLOCK",reason:"แรงเคลื่อนไหวยังน้อยเกินไป · รอข้อมูลเพิ่ม"};
  if(up>=70&&up-down>=12&&(buyPressure||buyReject)&&(buyMomentum||breakUp))
    return {...base,signal:"CALL",candidateSignal:"CALL",score:up,status:"EARLY_BUY_PRESSURE_CONFIRMED",
      alertId:`ENGINE_4:${live.epoch}:CALL:EARLY`,
      reason:"CALL ระยะแรก · แรงซื้อ/การปฏิเสธราคาสอดคล้องกับโมเมนตัมและโครงสร้างระยะสั้น"};
  if(down>=70&&down-up>=12&&(sellPressure||sellReject)&&(sellMomentum||breakDown))
    return {...base,signal:"PUT",candidateSignal:"PUT",score:down,status:"EARLY_SELL_PRESSURE_CONFIRMED",
      alertId:`ENGINE_4:${live.epoch}:PUT:EARLY`,
      reason:"PUT ระยะแรก · แรงขาย/การปฏิเสธราคาสอดคล้องกับโมเมนตัมและโครงสร้างระยะสั้น"};
  return {...base,status:score>=50?"EARLY_ENTRY_WATCH":"EARLY_ENTRY_STANDBY",
    reason:score>=50?"เริ่มเห็นแรงราคา แต่หลักฐานยังไม่ครบเกณฑ์เข้า":`คะแนนแรงซื้อ/ขาย ${score}/100 ยังไม่ถึง 70`};
}
