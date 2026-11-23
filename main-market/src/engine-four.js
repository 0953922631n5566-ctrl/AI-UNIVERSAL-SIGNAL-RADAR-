/** Engine 4: analyze the last three fully closed M1 candles and forecast the next M1 candle. */
export const ENGINE4_DECISION_WINDOW_MS = 5_000;
export const ENGINE4_LOOKBACK_CANDLES = 3;
function validCandle(c) {
  return c && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status,strategy:"THREE_CLOSED_M1_CANDLES_TO_NEXT_M1_FORECAST",reason,...extra};
}
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const strategy="THREE_CLOSED_M1_CANDLES_TO_NEXT_M1_FORECAST";
  const targetCandleEpoch=Number.isFinite(options.targetCandleEpoch)?options.targetCandleEpoch:null;
  const now=Number.isFinite(options.now)?options.now:Date.now();
  if(targetCandleEpoch===null||targetCandleEpoch<0)
    return notReady("TARGET_CANDLE_NOT_READY","ยังไม่ทราบเวลาเริ่มต้นของแท่ง M1 ถัดไป");
  const elapsed=now-targetCandleEpoch*1000;
  if(elapsed<0)return notReady("INVALID_CANDLE_TIME","เวลาแท่ง M1 เป้าหมายไม่ถูกต้อง");
  if(elapsed>=ENGINE4_DECISION_WINDOW_MS)
    return notReady("DECISION_WINDOW_CLOSED","เลยช่วงเริ่มต้นแท่งใหม่ · ไม่ออกสัญญาณย้อนหลัง",
      {targetCandleEpoch,elapsedSeconds:+(elapsed/1000).toFixed(2)});
  const closed=(Array.isArray(candles)?candles:[]).filter(c=>c&&c.live!==true&&c.provisional!==true&&validCandle(c))
    .filter(c=>Number.isFinite(c.epoch)&&c.epoch+60<=targetCandleEpoch).slice(-ENGINE4_LOOKBACK_CANDLES);
  if(closed.length!==ENGINE4_LOOKBACK_CANDLES)
    return notReady("INSUFFICIENT_CLOSED_CANDLES","ต้องมีแท่ง M1 ปิดสมบูรณ์ 3 แท่งก่อนทำนายแท่งถัดไป",
      {targetCandleEpoch,closedCandlesAvailable:closed.length});
  const latestClosed=closed.at(-1);
  if(latestClosed.epoch+60!==targetCandleEpoch)
    return notReady("CLOSED_CANDLE_NOT_ALIGNED","แท่งปิดล่าสุดไม่ต่อเนื่องกับแท่งเป้าหมาย",
      {targetCandleEpoch,latestClosedCandleEpoch:latestClosed.epoch});
  const movements=closed.map(c=>c.close-c.open);
  const totalUp=movements.reduce((sum,v)=>sum+Math.max(0,v),0);
  const totalDown=movements.reduce((sum,v)=>sum+Math.max(0,-v),0);
  const netMovement=totalUp-totalDown,totalMovement=totalUp+totalDown;
  const tolerance=Math.max(1e-12,totalMovement*1e-9);
  const direction=netMovement>tolerance?"CALL":netMovement< -tolerance?"PUT":null;
  const latestBody=movements.at(-1);
  const previousBody=movements.slice(0,-1).reduce((sum,v)=>sum+v,0);
  const latestAgrees=direction==="CALL"?latestBody>0:direction==="PUT"?latestBody<0:false;
  const priorAgrees=direction==="CALL"?previousBody>0:direction==="PUT"?previousBody<0:false;
  const dominance=totalMovement>tolerance?Math.abs(netMovement)/totalMovement:0;
  const score=direction?Math.max(1,Math.min(100,Math.round(50+50*dominance))):0;
  const metrics={closedCandlesUsed:closed.map(c=>c.epoch),candleBodies:movements,
    upwardBodyMovement:totalUp,downwardBodyMovement:totalDown,netBodyMovement:netMovement,
    dominantDirection:direction==="CALL"?"UP":direction==="PUT"?"DOWN":"TIE",
    latestClosedCandleDirection:latestBody>0?"UP":latestBody<0?"DOWN":"FLAT",
    latestCandleAgrees:latestAgrees,previousTwoCandlesNetMovement:previousBody,
    previousTwoCandlesAgree:priorAgrees,directionalDominance:+dominance.toFixed(4),
    targetCandleEpoch,phase:"AFTER_PREVIOUS_M1_CLOSE"};
  const common={ready:true,decisionMade:true,candleEpoch:latestClosed.epoch,targetCandleEpoch,
    targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),elapsedSeconds:+(elapsed/1000).toFixed(2),
    strategy,metrics,analysisMode:"CLOSED_M1_NEXT_CANDLE"};
  if(!direction)return {...common,signal:null,candidateSignal:null,score:0,confidence:0,
    status:"CLOSED_CANDLE_PRESSURE_TIE",decisionStrength:"NONE",
    reason:"แรง Body ขาขึ้นและขาลงจาก 3 แท่งปิดเท่ากัน · งดทำนายเพื่อหลีกเลี่ยงการเดาสุ่ม"};
  const side=direction==="CALL"?"แรง Body ฝั่งขึ้นสะสมมากกว่า":"แรง Body ฝั่งลงสะสมมากกว่า";
  const confirmation=latestAgrees?"แท่งล่าสุดยืนยันทิศทางเดียวกัน":"แท่งล่าสุดสวนทางกับแรงสะสม · ลดความหนักแน่นของคำทำนาย";
  const calibratedScore=latestAgrees?score:Math.max(1,Math.round(score*0.8));
  const entryPrice=Number.isFinite(options.currentPrice)?options.currentPrice:null;
  return {...common,signal:direction,candidateSignal:direction,score:calibratedScore,confidence:calibratedScore,
    status:direction==="CALL"?"NEXT_M1_FORECAST_CALL":"NEXT_M1_FORECAST_PUT",
    decisionStrength:calibratedScore>=75?"STRONG":calibratedScore>=60?"MODERATE":"LIGHT",
    entryPrice,entryPriceBasis:"FIRST_STREAM_TICK_OF_TARGET_M1",
    evidenceSummary:side+" · วิเคราะห์แท่ง M1 ปิดสมบูรณ์ 3 แท่ง · "+confirmation,
    alertId:"ENGINE_4:"+targetCandleEpoch+":"+direction+":NEXT_M1_CLOSE_FORECAST",
    reason:direction+" · "+side+" · "+confirmation+" · คาดการณ์สำหรับแท่ง M1 ถัดไป"};
}
