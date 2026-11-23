/** Engine 4: detect a strong live M1 candle and prepare an entry for the next M1 open. */
export const ENGINE4_MIN_ELAPSED_MS = 5_000;
export const ENGINE4_MIN_BODY_PIPS = 0.4;
export const ENGINE4_MIN_BODY_RANGE_RATIO = 0.55;
export const ENGINE4_MIN_CLOSE_LOCATION = 0.72;
export const ENGINE4_MIN_SCORE = 65;

function validCandle(c) {
  return c && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status,strategy:"LIVE_M1_MOMENTUM_TO_NEXT_M1_ENTRY",reason,...extra};
}

/**
 * Direction comes only from the currently-forming M1 candle's real OHLC body.
 * Once momentum is sufficiently clear, latch a CALL/PUT candidate for the next
 * M1 candle. No three-candle history or broker execution is involved.
 */
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const live=options.liveCandle || (Array.isArray(candles)?candles.at(-1):null);
  const now=Number.isFinite(options.now)?options.now:Date.now();
  if(!live || live.live!==true || !Number.isFinite(live.epoch) || live.epoch<0 || !validCandle(live))
    return notReady("LIVE_M1_CANDLE_NOT_READY","Engine 4 ต้องใช้ OHLC ของแท่ง M1 ปัจจุบันที่กำลังวิ่งและข้อมูลจริง");
  const elapsed=now-live.epoch*1000;
  const targetCandleEpoch=live.epoch+60;
  if(elapsed<0)return notReady("INVALID_CANDLE_TIME","เวลาแท่ง M1 ปัจจุบันไม่ถูกต้อง");
  if(elapsed<ENGINE4_MIN_ELAPSED_MS)
    return notReady("COLLECTING_LIVE_MOMENTUM","กำลังรอแรงราคาเริ่มก่อตัวในแท่ง M1 ปัจจุบัน",
      {sourceCandleEpoch:live.epoch,targetCandleEpoch,elapsedSeconds:+(elapsed/1000).toFixed(2)});
  if(elapsed>=60_000)
    return notReady("SOURCE_CANDLE_CLOSED","แท่งต้นทางปิดแล้ว · รอข้อมูลแท่ง M1 ใหม่");
  const body=live.close-live.open;
  const range=live.high-live.low;
  const bodyPips=Math.abs(body)/0.0001;
  const bodyRangeRatio=range>0?Math.abs(body)/range:0;
  const closeLocation=range>0?(live.close-live.low)/range:0.5;
  const direction=body>0?"CALL":body<0?"PUT":null;
  const directionalCloseLocation=direction==="CALL"?closeLocation:direction==="PUT"?1-closeLocation:0;
  const score=direction?Math.round((bodyRangeRatio*0.55+directionalCloseLocation*0.45)*100):0;
  const metrics={sourceCandleEpoch:live.epoch,targetCandleEpoch,elapsedSeconds:+(elapsed/1000).toFixed(2),
    liveOpen:live.open,liveHigh:live.high,liveLow:live.low,liveClose:live.close,
    bodyMovement:body,bodyPips:+bodyPips.toFixed(2),rangeMovement:range,
    bodyRangeRatio:+bodyRangeRatio.toFixed(4),closeLocation:+closeLocation.toFixed(4),
    directionalCloseLocation:+directionalCloseLocation.toFixed(4),minimumBodyPips:ENGINE4_MIN_BODY_PIPS,
    minimumBodyRangeRatio:ENGINE4_MIN_BODY_RANGE_RATIO,minimumDirectionalCloseLocation:ENGINE4_MIN_CLOSE_LOCATION,
    minimumScore:ENGINE4_MIN_SCORE,phase:"LIVE_M1_MOMENTUM"};
  if(!direction || bodyPips<ENGINE4_MIN_BODY_PIPS ||
    bodyRangeRatio<ENGINE4_MIN_BODY_RANGE_RATIO ||
    directionalCloseLocation<ENGINE4_MIN_CLOSE_LOCATION || score<ENGINE4_MIN_SCORE) {
    return {...notReady("NO_CLEAR_LIVE_MOMENTUM","แรงราคาในแท่งปัจจุบันยังไม่ชัดพอ · รอจังหวะที่มี Body และตำแหน่งปิดแท่งยืนยัน",
      {sourceCandleEpoch:live.epoch,targetCandleEpoch,elapsedSeconds:+(elapsed/1000).toFixed(2)}),
      metrics,score,directionCandidate:direction};
  }
  const side=direction==="CALL"?"แรงซื้อดันราคาขึ้นและปิดใกล้จุดสูงของแท่ง":"แรงขายกดราคาลงและปิดใกล้จุดต่ำของแท่ง";
  return {ready:true,decisionMade:true,signal:direction,candidateSignal:direction,score,confidence:score,
    sourceCandleEpoch:live.epoch,candleEpoch:live.epoch,targetCandleEpoch,
    targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),
    elapsedSeconds:+(elapsed/1000).toFixed(2),strategy:"LIVE_M1_MOMENTUM_TO_NEXT_M1_ENTRY",
    analysisMode:"LIVE_M1_BODY_MOMENTUM",decisionStrength:score>=80?"STRONG":"MODERATE",
    entryPrice:null,entryPriceBasis:"FIRST_STREAM_TICK_OF_TARGET_M1",
    status:direction==="CALL"?"NEXT_M1_MOMENTUM_CALL":"NEXT_M1_MOMENTUM_PUT",
    metrics,evidenceSummary:side+" · ใช้เฉพาะ OHLC ของแท่ง M1 ที่กำลังวิ่ง",
    alertId:"ENGINE_4:"+targetCandleEpoch+":"+direction+":LIVE_M1_MOMENTUM",
    reason:direction+" · "+side+" · เตรียมเข้าแท่ง M1 ถัดไปเมื่อแท่งนั้นเริ่ม"};
}
