/** Engine 4: compare the latest completed M1 close with EMA 5. */
export const ENGINE4_EMA_PERIOD = 5;
export const ENGINE4_MIN_CANDLES = ENGINE4_EMA_PERIOD;
function validCandle(c) {
  return c && c.live === false && Number.isFinite(c.epoch) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,status,
    strategy:"EMA5_CLOSED_M1_TO_NEXT_M1_ENTRY",reason,...extra};
}
function calculateEma(values,period) {
  if (!Array.isArray(values) || values.length < period || values.some(v=>!Number.isFinite(v))) return null;
  const seed=values.slice(0,period).reduce((sum,v)=>sum+v,0)/period;
  const multiplier=2/(period+1);
  return values.slice(period).reduce((ema,v)=>v*multiplier+ema*(1-multiplier),seed);
}
/** Closed M1 Close > EMA5 => CALL; Close < EMA5 => PUT; equality => no signal. */
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const closed=options.closedCandle || (Array.isArray(candles)?candles.at(-1):null);
  if (!validCandle(closed)) return notReady("CLOSED_M1_CANDLE_NOT_READY",
    "Engine 4 ต้องใช้ราคาปิดของแท่ง M1 ที่ปิดสมบูรณ์แล้วเท่านั้น");
  const history=(Array.isArray(candles)?candles:[])
    .filter(c=>validCandle(c)&&c.epoch<=closed.epoch).sort((a,b)=>a.epoch-b.epoch);
  const contiguous=[];
  for(let i=history.length-1;i>=0;i-=1) {
    if(contiguous.length&&contiguous.at(-1).epoch-history[i].epoch!==60) break;
    contiguous.push(history[i]);
  }
  contiguous.reverse();
  if(contiguous.length<ENGINE4_MIN_CANDLES||contiguous.at(-1)?.epoch!==closed.epoch)
    return notReady("EMA_HISTORY_NOT_READY",
      "Engine 4 ต้องมีแท่ง M1 ที่ปิดสมบูรณ์และต่อเนื่องอย่างน้อย 5 แท่งเพื่อคำนวณ EMA 5",
      {requiredClosedCandles:ENGINE4_MIN_CANDLES,availableClosedCandles:contiguous.length});
  const ema5=calculateEma(contiguous.map(c=>c.close),ENGINE4_EMA_PERIOD);
  if(!Number.isFinite(ema5)) return notReady("EMA_NOT_READY","ยังคำนวณ EMA 5 จากแท่ง M1 ที่ปิดแล้วไม่ได้");
  const sourceCandleEpoch=closed.epoch;
  const targetCandleEpoch=sourceCandleEpoch+60;
  const difference=closed.close-ema5;
  if(difference===0) return {
    ...notReady("CLOSE_EQUALS_EMA5","ราคาปิดเท่ากับ EMA 5 · งดส่งสัญญาณ"),
    sourceCandleEpoch,targetCandleEpoch,
    metrics:{ema5:+ema5.toFixed(6),closedClose:closed.close,closeMinusEma5:0}
  };
  const signal=difference>0?"CALL":"PUT";
  const side=signal==="CALL"?"ราคาปิดแท่ง M1 ล่าสุดอยู่เหนือ EMA 5":"ราคาปิดแท่ง M1 ล่าสุดอยู่ใต้ EMA 5";
  return {
    ready:true,decisionMade:true,signal,candidateSignal:signal,
    sourceCandleEpoch,candleEpoch:sourceCandleEpoch,targetCandleEpoch,
    targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),
    strategy:"EMA5_CLOSED_M1_TO_NEXT_M1_ENTRY",analysisMode:"EMA5_CLOSED_M1_CLOSE_ONLY",
    entryPrice:null,entryPriceBasis:"FIRST_FRESH_STREAM_TICK_OF_NEXT_M1",
    status:signal==="CALL"?"NEXT_M1_EMA5_CALL":"NEXT_M1_EMA5_PUT",
    metrics:{sourceCandleEpoch,targetCandleEpoch,ema5:+ema5.toFixed(6),
      closedClose:closed.close,closeMinusEma5:+difference.toFixed(6),
      emaPeriod:ENGINE4_EMA_PERIOD,emaHistoryCandles:contiguous.length,phase:"CLOSED_M1_EMA5_CLOSE_ONLY"},
    evidenceSummary:side+" · ใช้ Close เทียบ EMA 5 เท่านั้น",
    alertId:"ENGINE_4:"+targetCandleEpoch+":"+signal+":EMA5_CLOSED_M1",
    reason:signal+" · "+side+" · ส่งสัญญาณสำหรับแท่ง M1 ถัดไป"
  };
}
