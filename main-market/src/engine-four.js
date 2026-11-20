/** Engine 4: 3 closed M1 bodies + current live tick path; PREPARE at T-10, final at T-5. */
export const ENGINE4_COLLECTION_WINDOW_MS = 50_000;
export const ENGINE4_DECISION_AT_MS = 55_000;
export const ENGINE4_ENTRY_WINDOW_MS = 60_000;
function validCandle(c) {
  return c && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low>0 &&
    c.high>=Math.max(c.open,c.close) && c.low<=Math.min(c.open,c.close) && c.high>=c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status,strategy:"M1_THREE_CLOSED_PLUS_LIVE_TICK_T10_T5",reason,...extra};
}
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const live=Array.isArray(candles)?candles.at(-1):null;
  const strategy="M1_THREE_CLOSED_PLUS_LIVE_TICK_T10_T5";
  if(!options.livePreview||!live||(live.live!==true&&live.provisional!==true)||
    !Number.isFinite(live.epoch)||live.epoch<0||!validCandle(live))
    return notReady("NOT_READY","Engine 4 ต้องใช้แท่ง M1 ปัจจุบันและราคา Streaming สด");
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const elapsed=now-live.epoch*1000;
  if(elapsed<0)return notReady("INVALID_CANDLE_TIME","เวลาแท่ง M1 ไม่ถูกต้อง");
  if(elapsed<ENGINE4_COLLECTION_WINDOW_MS)return {
    ready:true,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status:"COLLECTING_PRICE_PRESSURE",candleEpoch:live.epoch,
    elapsedSeconds:+(elapsed/1000).toFixed(2),strategy,
    reason:"กำลังสะสม Tick จากต้นแท่ง · อ่านแท่งปิดย้อนหลัง 3 แท่ง · เตรียมประเมินที่ T-10"
  };
  if(elapsed>=ENGINE4_ENTRY_WINDOW_MS)return {
    ready:true,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status:"DECISION_WINDOW_CLOSED",candleEpoch:live.epoch,
    elapsedSeconds:Math.floor(elapsed/1000),strategy,
    reason:"พ้นช่วงตัดสินใจของแท่ง M1 นี้แล้ว · รอแท่งถัดไป"
  };
  const closed=candles.filter(c=>c&&c!==live&&c.live!==true&&c.provisional!==true);
  const lastThree=closed.slice(-3);
  if(lastThree.length!==3||!lastThree.every(validCandle))
    return notReady("INSUFFICIENT_CLOSED_CANDLES","ต้องมีแท่ง M1 ที่ปิดแล้ว 3 แท่งเพื่อคำนวณแรงสะสม",
      {candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000)});
  const ticks=options.tickStats;
  if(!ticks||ticks.candleEpoch!==live.epoch||!Number.isFinite(ticks.upMovement)||
    !Number.isFinite(ticks.downMovement)||ticks.upMovement<0||ticks.downMovement<0||ticks.totalTicks<1)
    return notReady("LIVE_TICK_PATH_NOT_READY","ยังเก็บเส้นทางราคา Streaming ของแท่งปัจจุบันไม่ครบ",
      {candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000)});
  // Historical OHLC has no historical tick path: use each candle's net body.
  // Current M1 contributes actual positive/negative tick-to-tick movement from open to T-5.
  const closedUp=lastThree.reduce((s,c)=>s+Math.max(0,c.close-c.open),0);
  const closedDown=lastThree.reduce((s,c)=>s+Math.max(0,c.open-c.close),0);
  const liveUp=ticks.upMovement,liveDown=ticks.downMovement;
  const totalUp=closedUp+liveUp,totalDown=closedDown+liveDown,diff=totalUp-totalDown;
  const tolerance=Math.max(1e-12,(totalUp+totalDown)*1e-9);
  const direction=diff>tolerance?"CALL":diff< -tolerance?"PUT":null;
  const finalDecision=elapsed>=ENGINE4_DECISION_AT_MS;
  const recent=Array.isArray(ticks.recentSamples)?ticks.recentSamples.filter(s=>s&&
    Number.isFinite(s.at)&&Number.isFinite(s.price)&&s.at<=now&&s.at>=now-5000):[];
  let continuation="UNKNOWN",recentNet=null;
  if(recent.length>=2){recentNet=recent.at(-1).price-recent[0].price;
    continuation=recentNet>0?"UP":recentNet<0?"DOWN":"FLAT";}
  const supports=direction&&continuation!=="UNKNOWN"?
    (direction==="CALL"?continuation==="UP":continuation==="DOWN"):null;
  const price=Number.isFinite(options.currentPrice)?options.currentPrice:live.close;
  const total=totalUp+totalDown;
  const score=direction?Math.max(1,Math.min(100,Math.round(50+50*Math.abs(diff)/Math.max(total,tolerance)))):0;
  const metrics={closedCandlesUsed:lastThree.map(c=>c.epoch),closedUpMovement:closedUp,
    closedDownMovement:closedDown,liveUpMovement:liveUp,liveDownMovement:liveDown,
    totalUpMovement:totalUp,totalDownMovement:totalDown,netMovement:diff,
    dominantDirection:direction==="CALL"?"UP":direction==="PUT"?"DOWN":"TIE",
    continuationWindowSeconds:5,continuationDirection:continuation,recentNetMovement:recentNet,
    continuationSupportsDominant:supports,
    continuationPolicy:"OBSERVE_ONLY_DO_NOT_OVERRIDE_ACCUMULATED_DIRECTION",
    currentPrice:price,liveOpen:live.open,liveTickCount:ticks.totalTicks,
    liveSamplesInContinuationWindow:recent.length,elapsedSeconds:+(elapsed/1000).toFixed(2),
    phase:finalDecision?"T5_FINAL":"T10_PREPARE"};
  if(!direction)return {ready:true,decisionMade:finalDecision,signal:null,candidateSignal:null,
    score:0,confidence:0,candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),strategy,
    status:finalDecision?"ACCUMULATED_PRESSURE_TIE":"PREPARE_NO_DOMINANT_PRESSURE",
    decisionStrength:"NONE",metrics,reason:finalDecision?
      "แรงขึ้นสะสมและแรงลงสะสมเท่ากัน · ไม่มีทิศทางที่มากกว่า จึงไม่ออกสัญญาณ":
      "กำลังประเมินแรงสะสมที่ T-10 · ยังไม่มีฝั่งที่ได้เปรียบชัดเจน"};
  const side=direction==="CALL"?"แรงขึ้นสะสมมากกว่า":"แรงลงสะสมมากกว่า";
  const continuationText=continuation==="UNKNOWN"?"ยังไม่มีข้อมูลช่วงท้าย 5 วินาทีเพียงพอ":
    supports?"แรงช่วงท้าย 5 วินาทีสนับสนุนทิศทางเดียวกัน":
    "แรงช่วงท้าย 5 วินาทีสวนทาง แต่ไม่เปลี่ยนทิศทางแรงสะสมหลัก";
  return {ready:true,decisionMade:finalDecision,signal:direction,candidateSignal:direction,
    score,confidence:score,candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),strategy,
    entryPrice:price,entryPriceBasis:"THREE_CLOSED_M1_BODY_PLUS_LIVE_M1_TICK_PATH_AT_T5",
    status:finalDecision?(direction==="CALL"?"ACCUMULATED_PRESSURE_CALL":"ACCUMULATED_PRESSURE_PUT"):
      (direction==="CALL"?"PREPARE_PRESSURE_CALL":"PREPARE_PRESSURE_PUT"),
    decisionStrength:score>=75?"STRONG":score>=60?"MODERATE":"LIGHT",metrics,
    evidenceSummary:side+" · เปรียบเทียบแรงสะสม 3 แท่งปิดกับ Tick ของแท่งปัจจุบัน · "+continuationText,
    alertId:"ENGINE_4:"+live.epoch+":"+direction+":ACCUMULATED_PRESSURE_T5",
    reason:direction+" · "+side+" · "+(finalDecision?"ยืนยันที่ T-5":"ประเมินเบื้องต้นที่ T-10")+" · "+continuationText};
}
