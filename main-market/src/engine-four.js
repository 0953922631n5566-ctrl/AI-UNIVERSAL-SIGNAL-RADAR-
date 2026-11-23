/** Engine 4: Twelve Data native EMA(5) + Momentum(9) + live Twelve Data quote. */
export const ENGINE4_STRATEGY="TWELVE_DATA_EMA5_MOMENTUM9_LIVE";
const MAX_TICK_AGE_MS=5000,MAX_INDICATOR_AGE_MS=120000;
function notReady(status,reason,metrics=null){return{ready:false,decisionMade:false,signal:null,candidateSignal:null,status,strategy:ENGINE4_STRATEGY,reason,metrics};}
function validPair(values,key){return Array.isArray(values)&&values.length>=2&&values.slice(-2).every(p=>p&&Number.isFinite(p.epoch)&&Number.isFinite(p[key]))&&values.at(-1).epoch-values.at(-2).epoch===60;}
export function analyzeEarlyEntryEngine4({emaValues,momentumValues,livePrice,tickAt,now=Date.now(),sourceCandleEpoch=Math.floor(now/60000)*60,state=null}={}){
 if(!validPair(emaValues,"ema"))return notReady("EMA5_API_NOT_READY","รอ EMA 5 จาก Twelve Data");
 if(!validPair(momentumValues,"momentum"))return notReady("MOMENTUM9_API_NOT_READY","รอ Momentum 9 จาก Twelve Data");
 const ema=emaValues.at(-1),mom=momentumValues.at(-1),emaAge=now-(ema.epoch+60)*1000,momAge=now-(mom.epoch+60)*1000;
 if(![emaAge,momAge].every(x=>Number.isFinite(x)&&x>=-5000&&x<=MAX_INDICATOR_AGE_MS))return notReady("TWELVE_DATA_INDICATOR_STALE","EMA 5 หรือ Momentum 9 จาก Twelve Data เก่าเกินกำหนด");
 if(!Number.isFinite(livePrice)||livePrice<=0||!Number.isFinite(tickAt)||tickAt>now||now-tickAt>MAX_TICK_AGE_MS)return notReady("LIVE_PRICE_STALE","รอราคา Streaming สดจาก Twelve Data");
 if(!Number.isFinite(sourceCandleEpoch))return notReady("M1_CANDLE_NOT_READY","รอเวลาแท่ง M1 ปัจจุบัน");
 if(state?.triggeredCandleEpoch===sourceCandleEpoch)return notReady("ENGINE4_ALREADY_TRIGGERED_THIS_CANDLE","Engine 4 ส่งสัญญาณแล้วในแท่ง M1 นี้");
 const above=livePrice>ema.ema,below=livePrice<ema.ema,positive=mom.momentum>0,negative=mom.momentum<0,signal=above&&positive?"CALL":below&&negative?"PUT":null;
 const metrics={ema5:ema.ema,ema5Epoch:ema.epoch,momentum9:mom.momentum,momentum9Epoch:mom.epoch,livePrice,aboveEma5:above,belowEma5:below,positiveMomentum:positive,negativeMomentum:negative,emaSource:"TWELVE_DATA_NATIVE_EMA_ENDPOINT",momentumSource:"TWELVE_DATA_NATIVE_MOM_ENDPOINT",priceSource:"TWELVE_DATA_STREAMING"};
 if(!signal){const reason=livePrice===ema.ema?"ราคาทับ EMA 5 · รอทิศทาง":above?"ราคาอยู่เหนือ EMA 5 แต่ Momentum 9 ยังไม่เป็นบวก":below?"ราคาอยู่ใต้ EMA 5 แต่ Momentum 9 ยังไม่เป็นลบ":"รอ EMA 5 และ Momentum 9 สอดคล้องกัน";return notReady("ENGINE4_WAITING_FOR_ALIGNMENT",reason,metrics);}
 const reason=signal==="CALL"?"ราคา Streaming อยู่เหนือ EMA 5 และ Momentum 9 เป็นบวก · CALL":"ราคา Streaming อยู่ใต้ EMA 5 และ Momentum 9 เป็นลบ · PUT";
 return{ready:true,decisionMade:true,signal,candidateSignal:signal,sourceCandleEpoch,candleEpoch:sourceCandleEpoch,targetCandleEpoch:sourceCandleEpoch,targetCandleAt:new Date(sourceCandleEpoch*1000).toISOString(),entryPrice:livePrice,entryPriceBasis:"TWELVE_DATA_STREAMING_PRICE",strategy:ENGINE4_STRATEGY,analysisMode:ENGINE4_STRATEGY,status:signal==="CALL"?"EMA5_MOMENTUM9_CALL":"EMA5_MOMENTUM9_PUT",trigger:"EMA5_MOMENTUM9_ALIGNMENT",metrics,evidenceSummary:reason,reason,alertId:"ENGINE_4:"+sourceCandleEpoch+":"+signal+":EMA5_MOMENTUM9"};
}