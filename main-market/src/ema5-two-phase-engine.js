export const EMA5_STRATEGY_ID = "EMA5_PULLBACK_SR_TWO_PHASE_M1";
const EMA_PERIOD = 5;
const EMA_ALPHA = 2 / (EMA_PERIOD + 1);
const MIN_HISTORY = 20;
const PIP = 0.0001;
const SR_LOOKBACK = 15;
const SR_NEAR_PIPS = 5.0;
const SR_CLEAR_PIPS = 2.0;
const EMA_RETEST_TOLERANCE_PIPS = 1.5;
const SLOPE_FLAT_PIPS = 0.05;
export function samplingPhase(epochSeconds) {
  const second = ((Math.floor(epochSeconds) % 60) + 60) % 60;
  if (second <= 2) return "OPEN";
  if (second >= 55) return "PREPARE";
  return "COLLECT";
}
export function calculateEma5(closes) {
  const values = closes.map(Number).filter(Number.isFinite);
  if (values.length < EMA_PERIOD + 1) return null;
  const seed = values.slice(0, EMA_PERIOD).reduce((sum, value) => sum + value, 0) / EMA_PERIOD;
  let ema = seed; const result = [ema];
  for (let i = EMA_PERIOD; i < values.length; i++) { ema = values[i] * EMA_ALPHA + ema * (1 - EMA_ALPHA); result.push(ema); }
  return { current: result.at(-1), previous: result.at(-2) };
}
function findZones(candles, price) {
  const recent = candles.slice(-SR_LOOKBACK);
  const supports = [], resistances = [];
  for (let i = 1; i < recent.length - 1; i++) {
    const c = recent[i], p = recent[i - 1], n = recent[i + 1];
    if (c.low <= p.low && c.low <= n.low) supports.push(c.low);
    if (c.high >= p.high && c.high >= n.high) resistances.push(c.high);
  }
  return { support: supports.length ? Math.max(...supports) : Math.min(...recent.map(c => c.low)),
    resistance: resistances.length ? Math.min(...resistances) : Math.max(...recent.map(c => c.high)) };
}
export function analyzeEma5Pullback({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  if (symbol !== "EUR/USD") return { signal:"WAIT", slope:"WAIT", reason:"ระบบนี้ล็อกเฉพาะ EUR/USD" };
  if (!liveCandle || liveCandle.live !== true) return { signal:"WAIT", slope:"WAIT", reason:"รอแท่ง M1 ปัจจุบัน" };
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) return { signal:"WAIT", slope:"WAIT", reason:"รอราคา Streaming สดไม่เกิน 5 วินาที" };
  const closed = [...(closedCandles || [])].filter(c => c && c.live !== true && Number.isFinite(c.epoch)).sort((a,b)=>a.epoch-b.epoch);
  if (closed.length < MIN_HISTORY) return { signal:"WAIT", slope:"WAIT", reason:`ประวัติแท่งปิดไม่พอ (${closed.length}/${MIN_HISTORY})` };
  const recent = closed.slice(-SR_LOOKBACK);
  const closes = [...closed.map(c=>Number(c.close)), Number(liveCandle.close)];
  if (closes.some(v=>!Number.isFinite(v)) || ![liveCandle.open,liveCandle.high,liveCandle.low,liveCandle.close].every(Number.isFinite))
    return { signal:"WAIT", slope:"WAIT", reason:"OHLC ไม่สมบูรณ์" };
  const ema=calculateEma5(closes); if(!ema)return{signal:"WAIT",slope:"WAIT",reason:"คำนวณ EMA5 ไม่สำเร็จ"};
  const delta=ema.current-ema.previous, slopePips=delta/PIP;
  const slope=Math.abs(slopePips)<SLOPE_FLAT_PIPS?"FLAT":delta>0?"UP":"DOWN";
  const zones=findZones(recent,liveCandle.close), supportDistancePips=(liveCandle.close-zones.support)/PIP, resistanceDistancePips=(zones.resistance-liveCandle.close)/PIP;
  const nearSupport=liveCandle.low<=zones.support+SR_NEAR_PIPS*PIP && liveCandle.low>=zones.support-SR_NEAR_PIPS*PIP;
  const nearResistance=liveCandle.high>=zones.resistance-SR_NEAR_PIPS*PIP && liveCandle.high<=zones.resistance+SR_NEAR_PIPS*PIP;
  const supportIntact=liveCandle.low>=zones.support-SR_NEAR_PIPS*PIP;
  const resistanceIntact=liveCandle.high<=zones.resistance+SR_NEAR_PIPS*PIP;
  const common={ema5:ema.current,previousEma5:ema.previous,slope,slopePips:Number(slopePips.toFixed(3)),
    openPrice:liveCandle.open,closePrice:liveCandle.close,highPrice:liveCandle.high,lowPrice:liveCandle.low,
    support:zones.support,resistance:zones.resistance,supportDistancePips:Number(supportDistancePips.toFixed(1)),
    resistanceDistancePips:Number(resistanceDistancePips.toFixed(1)),nearSupport,nearResistance,supportIntact,resistanceIntact,srLookback:SR_LOOKBACK,
    sourceCandleEpoch:liveCandle.epoch,targetCandleEpoch:liveCandle.epoch+60,tickAgeSeconds:Number(tickAgeSeconds.toFixed(2)),
    indicator:"EMA5",source:"Twelve Data M1 OHLC + local EMA5 + local swing S/R"};
  if(slope==="FLAT")return{...common,signal:"WAIT",regime:"SIDEWAY",reason:"EMA5 แบนราบ · SIDEWAY · งดส่งสัญญาณ"};
  if(slope==="UP"&&supportIntact&&(liveCandle.low<=ema.current+EMA_RETEST_TOLERANCE_PIPS*PIP||nearSupport)&&liveCandle.close>liveCandle.open&&liveCandle.close>ema.current&&Math.abs(resistanceDistancePips)>SR_CLEAR_PIPS)
    return{...common,signal:"CALL",regime:"UPTREND",reason:`EMA5 UP + Pullback + ${nearSupport?"Near Support":"EMA5 Retest"} · ยังมีระยะถึงแนวต้านย่อย`};
  if(slope==="DOWN"&&resistanceIntact&&(liveCandle.high>=ema.current-EMA_RETEST_TOLERANCE_PIPS*PIP||nearResistance)&&liveCandle.close<liveCandle.open&&liveCandle.close<ema.current&&Math.abs(supportDistancePips)>SR_CLEAR_PIPS)
    return{...common,signal:"PUT",regime:"DOWNTREND",reason:`EMA5 DOWN + Pullback + ${nearResistance?"Near Resistance":"EMA5 Retest"} · ยังมีระยะถึงแนวรับย่อย`};
  if((slope==="UP"&&!supportIntact)||(slope==="DOWN"&&!resistanceIntact)||(slope==="UP"&&resistanceDistancePips<=SR_CLEAR_PIPS)||(slope==="DOWN"&&supportDistancePips<=SR_CLEAR_PIPS))
    return{...common,signal:"WAIT",regime:"SR_BLOCK",reason:"ราคาอยู่ชิดแนวต้าน/แนวรับย่อย · เสี่ยงชนโซนกลับตัว"};
  if(Math.abs(supportDistancePips)>25&&Math.abs(resistanceDistancePips)>25)
    return{...common,signal:"WAIT",regime:"NO_ZONE",reason:"ราคาอยู่กลางทาง · ยังไม่มีโซน S/R ใกล้เคียง"};
  return{...common,signal:"WAIT",regime:"WAIT",reason:"ยังไม่ครบเงื่อนไข EMA5 Pullback + S/R"};
}
export function enterPreparedSignal(state,targetEpoch){
  if(!state||!Number.isFinite(targetEpoch)||state.preparedForEpoch!==targetEpoch||!["CALL","PUT"].includes(state.preparedSignal)||state.enteredEpoch===targetEpoch)return null;
  state.enteredEpoch=targetEpoch;state.phase="ENTER";state.signal=state.preparedSignal;
  state.alertId=`${state.sourceEpoch}:${targetEpoch}:${state.preparedSignal}:EMA5_SR`;
  state.enteredAt=new Date(targetEpoch*1000).toISOString();
  state.history=[{id:state.alertId,signal:state.signal,sourceEpoch:state.sourceEpoch,targetEpoch,issuedAt:state.enteredAt,status:"ENTER"},...(state.history||[])].slice(0,10);
  return{signal:state.signal,alertId:state.alertId,targetEpoch};
}
export const EMA5_MIN_HISTORY=MIN_HISTORY;
