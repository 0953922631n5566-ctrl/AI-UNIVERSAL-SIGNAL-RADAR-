const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const round=v=>Math.round(v*10)/10;
const SIGNAL_THRESHOLD=80, PREPARE_THRESHOLD=60, MIN_DIRECTION_GAP=12;
function sideScore(candles,base,direction){
 const m=base.metrics||{},s=base.structureCandle||{},c=candles.at(-1),call=direction==="CALL",sign=call?1:-1;
 const biasMatch=s.bias===(call?"BULLISH":"BEARISH"),eventMatch=call?["BOS_UP","CHOCH_UP"].includes(s.event):["BOS_DOWN","CHOCH_DOWN"].includes(s.event),eventOppose=call?["BOS_DOWN","CHOCH_DOWN"].includes(s.event):["BOS_UP","CHOCH_UP"].includes(s.event);
 const structureScore=25*(biasMatch ? 0.60 : s.bias==="UNCONFIRMED" ? 0.32 : s.bias==="MIXED" ? 0.40 : 0.08)+(eventMatch?10:eventOppose?0:0);
 const range=Math.max(c.high-c.low,1e-12),bodyRatio=Math.abs(c.close-c.open)/range,closeLocation=clamp((c.close-c.low)/range),directional=call?c.close>c.open:c.close<c.open,loc=call?closeLocation:1-closeLocation,wick=call?(Math.min(c.open,c.close)-c.low)/range:(c.high-Math.max(c.open,c.close))/range;
 const priceScore=25*(.40*(directional?1:.25)+.35*loc+.25*clamp(wick/.45));
 const slope=Number.isFinite(m.ema5Slope)?sign*m.ema5Slope:0,slopeScore=clamp(slope/Math.max(Number(m.atr14)||0,1e-10)*18),rsi=Number.isFinite(m.rsi)?m.rsi:50;
 const rsiScore=call?clamp((rsi-48)/17)*clamp((78-rsi)/12):clamp((52-rsi)/17)*clamp((rsi-22)/12),dmi=Number.isFinite(m.plusDI)&&Number.isFinite(m.minusDI)?(call?m.plusDI>m.minusDI:m.minusDI>m.plusDI):false;
 const momentumScore=20*(.35*slopeScore+.35*rsiScore+.30*(dmi?1:.15));
 const kama=call?m.kamaRising===true:m.kamaFalling===true,ema=call?c.close>m.ema5:c.close<m.ema5,adx=Number.isFinite(m.adx)?clamp(m.adx/25):0;
 const trendScore=15*(.47*(kama?1:.15)+.27*(ema?1:.2)+.26*adx),guard=base.riskGuard?.level||"DANGER",safety=5*(candles.length>=54?1:0)+(guard==="NORMAL"?10:guard==="WATCH"?6:0);
 const components={marketStructure:round(structureScore),priceAction:round(priceScore),momentum:round(momentumScore),trendAlignment:round(trendScore),volatilityDataQuality:round(safety)};
 return {score:round(Object.values(components).reduce((a,b)=>a+b,0)),components,details:{bias:s.bias,event:s.event,candlePattern:s.candlePattern,rsi,ema5Slope:m.ema5Slope,kamaAligned:kama,dmiAligned:dmi,adx,guard}};
}
export function applyPrecisionEntryFormula(candles,base){
 if(!Array.isArray(candles)||candles.length<54||!base?.metrics||!base?.riskGuard)return {...base,signal:"STANDBY",status:"STANDBY",prepareSignal:null,reason:"Precision Entry: ข้อมูลแท่งเทียนหรืออินดิเคเตอร์ไม่ครบ",precisionEntry:{version:"M1_PRECISION_ENTRY_V1",ready:false,blocked:true,reason:"INSUFFICIENT_CONTEXT"}};
 const call=sideScore(candles,base,"CALL"),put=sideScore(candles,base,"PUT"),scores={CALL:call.score,PUT:put.score},direction=scores.CALL>=scores.PUT?"CALL":"PUT",top=scores[direction],other=scores[direction==="CALL"?"PUT":"CALL"],gap=round(top-other),guard=base.riskGuard.level,blocked=base.riskGuard.blocked===true||guard==="DANGER";
 let signal="STANDBY",status="STANDBY",stage="NO_ENTRY";
 if(!blocked&&gap>=MIN_DIRECTION_GAP&&top>=SIGNAL_THRESHOLD){signal=direction;status="SIGNAL";stage="ENTRY_READY";}else if(!blocked&&gap>=8&&top>=PREPARE_THRESHOLD){signal="PREPARE";status="PREPARE";stage=top<70?"WATCH":"WAIT_CONFIRMATION";}
 const reason=blocked?"Precision Entry: Safety Guard DANGER — ระงับสัญญาณ":signal==="CALL"||signal==="PUT"?"M1 Precision Entry "+top+"/100 · "+direction+" · ส่วนต่าง "+gap+" · ผ่านเกณฑ์ "+SIGNAL_THRESHOLD:signal==="PREPARE"?"Precision "+stage+" · "+direction+" "+top+"/100 · รอหลักฐานเพิ่ม":"Precision Entry ยังไม่ผ่าน: คะแนน "+top+"/100 · ส่วนต่าง "+gap+" (ต้อง ≥"+MIN_DIRECTION_GAP+")";
 return {...base,signal,status,direction,score:top,confidence:top,scores,components:(direction==="CALL"?call:put).components,componentScores:{CALL:call.components,PUT:put.components},prepareSignal:signal==="PREPARE"?direction:null,reason,summary:reason,strategy:"M1_PRECISION_ENTRY_25_25_20_15_15",thresholds:{signal:SIGNAL_THRESHOLD,prepare:PREPARE_THRESHOLD,minDirectionGap:MIN_DIRECTION_GAP},precisionEntry:{version:"M1_PRECISION_ENTRY_V1",ready:true,blocked,stage,direction,scores,gap,thresholds:{entry:SIGNAL_THRESHOLD,prepare:PREPARE_THRESHOLD,minDirectionGap:MIN_DIRECTION_GAP},components:{CALL:call.components,PUT:put.components},details:{CALL:call.details,PUT:put.details},weights:{marketStructure:25,priceAction:25,momentum:20,trendAlignment:15,volatilityDataQuality:15}}};
}
