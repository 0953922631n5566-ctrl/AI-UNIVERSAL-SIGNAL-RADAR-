/** Engine 4: compare upper and lower wicks on the current live M1 candle. */
export const ENGINE4_STRATEGY = "LIVE_M1_WICK_ONLY_T5_NEXT_M1";
function validPreview(c) {
  return c && c.live === false && c.provisional === true && Number.isFinite(c.epoch) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,status,strategy:ENGINE4_STRATEGY,reason,...extra};
}
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const candle=options.liveCandle || (Array.isArray(candles)?candles.at(-1):null);
  if (!validPreview(candle)) return notReady("LIVE_M1_PREVIEW_NOT_READY","Engine 4 ต้องใช้ไส้เทียนจากแท่ง M1 ที่กำลังวิ่งและราคา Streaming สด");
  const upperWick=candle.high-Math.max(candle.open,candle.close);
  const lowerWick=Math.min(candle.open,candle.close)-candle.low;
  const sourceCandleEpoch=candle.epoch,targetCandleEpoch=sourceCandleEpoch+60;
  if (Math.abs(upperWick-lowerWick)<=1e-10) return {
    ...notReady("WICKS_EQUAL","ไส้บนและไส้ล่างยาวเท่ากัน · งดส่งสัญญาณ"),
    sourceCandleEpoch,targetCandleEpoch,
    metrics:{upperWick:+upperWick.toFixed(8),lowerWick:+lowerWick.toFixed(8)}
  };
  const signal=lowerWick>upperWick?"CALL":"PUT";
  const longer=signal==="CALL"?"ไส้ล่างยาวกว่าไส้บน":"ไส้บนยาวกว่าไส้ล่าง";
  return {ready:true,decisionMade:true,signal,candidateSignal:signal,sourceCandleEpoch,
    candleEpoch:sourceCandleEpoch,targetCandleEpoch,targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),
    strategy:ENGINE4_STRATEGY,analysisMode:"LIVE_M1_WICK_ONLY",
    status:signal==="CALL"?"LOWER_WICK_LONGER_CALL":"UPPER_WICK_LONGER_PUT",
    metrics:{sourceCandleEpoch,targetCandleEpoch,upperWick:+upperWick.toFixed(8),
      lowerWick:+lowerWick.toFixed(8),wickDifference:+Math.abs(lowerWick-upperWick).toFixed(8),phase:"LIVE_M1_WICK_ONLY_T5"},
    evidenceSummary:longer,alertId:"ENGINE_4:"+targetCandleEpoch+":"+signal+":WICK_ONLY_T5",
    reason:signal+" · "+longer+" · ยืนยันสัญญาณที่ T-5 สำหรับแท่ง M1 ถัดไป"};
}
