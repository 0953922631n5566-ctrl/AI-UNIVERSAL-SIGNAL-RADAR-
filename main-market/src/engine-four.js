const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
function valid(c) {
  return c && [c.epoch,c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    c.epoch >= 0 && c.low > 0 && c.high >= Math.max(c.open,c.close) &&
    c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function atr(rows, period=14) {
  const tr=rows.slice(1).map((c,i)=>Math.max(c.high-c.low,
    Math.abs(c.high-rows[i].close),Math.abs(c.low-rows[i].close)));
  return mean(tr.slice(-period));
}

/**
 * Engine 4: extreme sweep + rejection reversal.
 * A top reversal produces PUT; a bottom reversal produces CALL.
 * It only evaluates the validated, forming M1 candle in seconds 0-29.
 */
export function analyzeEarlyEntryEngine4(candles, options={}) {
  const minimum=Number.isInteger(options.minimumClosedCandles)?options.minimumClosedCandles:35;
  const rows=Array.isArray(candles)?candles.slice(-55):[];
  const live=rows.at(-1), closed=rows.slice(0,-1);
  const strategy="ENGINE_4_EXTREME_SWEEP_REJECTION_REVERSAL_0_30S";
  if(options.livePreview!==true || !live || (live.live!==true&&live.provisional!==true) ||
      !valid(live) || closed.length<minimum || !closed.every(c=>c.live!==true&&valid(c))) {
    return {ready:false,signal:null,candidateSignal:null,score:0,status:"NOT_READY",
      reason:`Engine 4 ต้องมีแท่งปิดอย่างน้อย ${minimum} แท่งและแท่ง M1 ปัจจุบันที่กำลังก่อตัว`,strategy};
  }
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const elapsed=now-live.epoch*1000;
  if(elapsed<0 || elapsed>=30000) return {ready:true,signal:null,candidateSignal:null,
    score:0,status:"ENTRY_WINDOW_CLOSED",candleEpoch:live.epoch,
    elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)),strategy,
    reason:"Engine 4 เปิดจังหวะสวนเฉพาะ 30 วินาทีแรกของแท่ง M1"};
  const history=closed.slice(-50), prev=history.at(-1), volatility=atr(history);
  if(!(volatility>0)) return {ready:true,signal:null,candidateSignal:null,score:0,
    status:"VOLATILITY_NOT_READY",candleEpoch:live.epoch,strategy,
    reason:"ข้อมูล ATR ยังไม่พร้อมสำหรับประเมินจุดกลับตัว"};
  const range=Math.max(live.high-live.low,Number.EPSILON);
  const body=live.close-live.open, bodyRatio=Math.abs(body)/range;
  const closePos=(live.close-live.low)/range;
  const upper=(live.high-Math.max(live.open,live.close))/range;
  const lower=(Math.min(live.open,live.close)-live.low)/range;
  const recent=history.slice(-6);
  const priorHigh=Math.max(...recent.map(c=>c.high));
  const priorLow=Math.min(...recent.map(c=>c.low));
  const sweepBuffer=volatility*.025;
  const sweptHigh=live.high>=priorHigh+sweepBuffer;
  const sweptLow=live.low<=priorLow-sweepBuffer;
  const topRejection=upper>=.30 && closePos<=.42 && live.close<priorHigh;
  const bottomRejection=lower>=.30 && closePos>=.58 && live.close>priorLow;
  const bearishTurn=body<0 || live.close<prev.close;
  const bullishTurn=body>0 || live.close>prev.close;
  const priorUp=history.slice(-5).filter((c,i,a)=>i>0&&c.close>a[i-1].close).length>=3;
  const priorDown=history.slice(-5).filter((c,i,a)=>i>0&&c.close<a[i-1].close).length>=3;
  const topContext=priorUp || history.slice(-5).at(-1).close>=history.slice(-5)[0].close;
  const bottomContext=priorDown || history.slice(-5).at(-1).close<=history.slice(-5)[0].close;
  const putScore=Math.round(30*Number(sweptHigh)+30*Number(topRejection)+
    20*Number(bearishTurn)+10*Number(topContext)+10*Number(closePos<=.30));
  const callScore=Math.round(30*Number(sweptLow)+30*Number(bottomRejection)+
    20*Number(bullishTurn)+10*Number(bottomContext)+10*Number(closePos>=.70));
  const score=Math.max(putScore,callScore);
  const abnormal=range>volatility*2.5;
  const base={ready:true,signal:null,candidateSignal:null,score,scoreUp:callScore,scoreDown:putScore,
    candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),
    targetCandleAt:new Date(live.epoch*1000).toISOString(),strategy,
    regime:putScore>callScore?"TOP_REVERSAL_WATCH":callScore>putScore?"BOTTOM_REVERSAL_WATCH":"NO_CLEAR_EXTREME",
    metrics:{atr:volatility,rangeAtr:+(range/volatility).toFixed(3),
      bodyRatio:+bodyRatio.toFixed(3),closeLocation:+closePos.toFixed(3),
      upperWickRatio:+upper.toFixed(3),lowerWickRatio:+lower.toFixed(3),
      priorHigh,priorLow,sweptHigh,sweptLow,topRejection,bottomRejection},
    evidence:[
      sweptHigh?"กวาดเหนือยอดเดิมแล้ว":"ยังไม่กวาดเหนือยอดเดิม",
      sweptLow?"กวาดใต้ฐานเดิมแล้ว":"ยังไม่กวาดใต้ฐานเดิม",
      topRejection?"มีไส้บนและปิดกลับใต้แนวต้าน":"ยังไม่ยืนยันแรงปฏิเสธที่ยอด",
      bottomRejection?"มีไส้ล่างและปิดกลับเหนือแนวรับ":"ยังไม่ยืนยันแรงปฏิเสธที่ฐาน",
      abnormal?"งดสัญญาณ: ช่วงราคาเกิน 2.5 ATR":"ผ่านตัวกรองช่วงราคา"
    ]};
  if(abnormal)return {...base,status:"ABNORMAL_RANGE_BLOCK",reason:"แท่ง M1 ผันผวนผิดปกติ · งดสวน"};
  if(sweptHigh&&topRejection&&bearishTurn&&putScore>=70&&putScore-callScore>=15)
    return {...base,signal:"PUT",candidateSignal:"PUT",score:putScore,status:"TOP_REVERSAL_CONFIRMED",
      alertId:`ENGINE_4:${live.epoch}:PUT:TOP_REVERSAL`,
      reason:"PUT สวนจากยอด · กวาดยอดเดิม มีไส้บนปฏิเสธราคาและแรงขายเริ่มกลับมา"};
  if(sweptLow&&bottomRejection&&bullishTurn&&callScore>=70&&callScore-putScore>=15)
    return {...base,signal:"CALL",candidateSignal:"CALL",score:callScore,status:"BOTTOM_REVERSAL_CONFIRMED",
      alertId:`ENGINE_4:${live.epoch}:CALL:BOTTOM_REVERSAL`,
      reason:"CALL สวนจากฐาน · กวาดฐานเดิม มีไส้ล่างปฏิเสธราคาและแรงซื้อเริ่มกลับมา"};
  return {...base,status:score>=50?"EXTREME_REVERSAL_WATCH":"EXTREME_REVERSAL_STANDBY",
    reason:score>=50?"พบสัญญาณเฝ้าระวังจุดกลับตัว แต่รอการยืนยันแรงสวน":"ยังไม่มีหลักฐานยืนยันยอด/ฐานและแรงกลับตัวครบเงื่อนไข"};
}
