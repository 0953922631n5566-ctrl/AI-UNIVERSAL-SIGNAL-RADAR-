const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const round1 = v => Math.round(v * 10) / 10;
function emaSeries(values, period) {
  const k=2/(period+1); let v=values[0]; const out=[v];
  for(let i=1;i<values.length;i++){v=values[i]*k+v*(1-k);out.push(v);}
  return out;
}
function trueRanges(candles) {
  return candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
}
function median(xs){if(!xs.length)return 0;const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(xs.length/2)];}
function atrAt(candles,end,period=14){
  const part=candles.slice(Math.max(0,end-period),end+1);
  const trs=part.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-part[i].close),Math.abs(c.low-part[i].close)));
  return mean(trs);
}
function efficiencyRatio(closes,period=10){
  if(closes.length<=period)return 0;
  const end=closes.length-1,start=end-period;
  const path=closes.slice(start+1,end+1).reduce((sum,value,i)=>sum+Math.abs(value-closes[start+i]),0);
  return path>0?Math.abs(closes[end]-closes[start])/path:0;
}
function adx14(candles){
  const start=Math.max(1,candles.length-15),dx=[];
  for(let i=start;i<candles.length;i++){
    const c=candles[i],p=candles[i-1],up=c.high-p.high,down=p.low-c.low;
    const plus=up>down&&up>0?up:0,minus=down>up&&down>0?down:0;
    const tr=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
    if(tr<=0)continue;
    const pdi=100*plus/tr,mdi=100*minus/tr;
    dx.push(100*Math.abs(pdi-mdi)/Math.max(pdi+mdi,1e-10));
  }
  return mean(dx);
}
function entryQuality(candles,direction,ema5,atr){
  const c=candles.at(-1),range=Math.max(c.high-c.low,1e-10),bullish=direction==="CALL";
  const closeLocation=bullish?(c.close-c.low)/range:(c.high-c.close)/range;
  const bodyRatio=Math.abs(c.close-c.open)/range,bodyAligned=bullish?c.close>c.open:c.close<c.open;
  const extension=atr>0?Math.abs(c.close-ema5)/atr:Infinity;
  let penalty=0;
  if(closeLocation<0.55)penalty+=10;else if(closeLocation<0.70)penalty+=5;
  if(bodyRatio<0.18&&!bodyAligned)penalty+=5;
  if(extension>0.85)penalty+=Math.min(14,(extension-0.85)*18);
  return {closeLocation,bodyRatio,bodyAligned,extension,penalty:Math.min(24,round1(penalty))};
}
function componentScore(candles,direction,ema5,ema20,atr){
  const n=candles.length,i=n-1,c=candles[i],p=candles[i-1],sign=direction==="CALL"?1:-1,bullish=sign===1;
  const slopeNow=ema5[i]-ema5[i-1],slopePrev=ema5[i-1]-ema5[i-2];
  const slopeNorm=atr>0?sign*slopeNow/atr:0,prevNorm=atr>0?sign*slopePrev/atr:0;
  const shift=clamp((slopeNorm+0.025)/0.10),reversal=clamp((slopeNorm-prevNorm+0.02)/0.10);
  const slopeScore=30*(0.55*shift+0.45*reversal);
  const prior=candles.slice(-8,-2),level=bullish?Math.min(...prior.map(x=>x.low)):Math.max(...prior.map(x=>x.high));
  const swept=bullish?Math.min(c.low,p.low):Math.max(c.high,p.high);
  const wick=bullish?Math.min(c.open,c.close)-c.low:c.high-Math.max(c.open,c.close);
  const range=Math.max(c.high-c.low,atr*0.02,1e-10),reclaim=bullish?c.close>level:c.close<level;
  const sweepDistance=bullish?level-swept:swept-level,wickRatio=wick/range;
  const sweepStrength=clamp(sweepDistance/Math.max(atr*0.12,1e-10));
  const wickStrength=clamp((wickRatio-0.12)/0.48);
  const reclaimStrength=reclaim?1:clamp(1-Math.abs(c.close-level)/Math.max(atr*0.25,1e-10));
  const fakeoutConfirmed=sweepDistance>0&&reclaim&&wickRatio>=0.35;
  const fakeoutScore=30*(fakeoutConfirmed?1:0.45*sweepStrength+0.35*wickStrength+0.20*reclaimStrength);
  const distance=atr>0?Math.abs(c.close-ema5[i])/atr:Infinity,near=clamp(1-distance/0.70);
  const momentum=bullish?clamp((c.close-c.open+Math.max(0,c.close-p.close)*0.5)/Math.max(atr*0.35,1e-10))
    :clamp((c.open-c.close+Math.max(0,p.close-c.close)*0.5)/Math.max(atr*0.35,1e-10));
  const proximityScore=20*(0.55*near+0.45*momentum);
  const aboveEma5=c.close>ema5[i],belowEma5=c.close<ema5[i];
  const structureMove=bullish?c.close-candles[Math.max(0,i-5)].close:candles[Math.max(0,i-5)].close-c.close;
  const structure=clamp(structureMove/Math.max(atr*0.9,1e-10)),emaSupport=bullish?aboveEma5:belowEma5;
  const trendScore=20*(0.55*structure+0.45*(emaSupport?1:0.25));
  const components={ema5SlopeReversal:round1(slopeScore),srFakeout:round1(fakeoutScore),
    proximityMomentum:round1(proximityScore),trendContext:round1(trendScore)};
  const quality=entryQuality(candles,direction,ema5[i],atr);
  const rawScore=Object.values(components).reduce((a,b)=>a+b,0);
  return {score:Math.max(0,round1(rawScore-quality.penalty)),rawScore:round1(rawScore),components,quality,
    details:{slopeNorm,prevNorm,sweepDistance,wickRatio,nearEma5:distance<=0.35,ema5,ema20}};
}
export function scoreMarket(candles){
  if(!Array.isArray(candles)||candles.length<30||!candles.every(c=>c&&[c.open,c.high,c.low,c.close].every(Number.isFinite)))
    return {signal:"STANDBY",score:0,reason:"ข้อมูล OHLC ไม่เพียงพอ",riskFlags:["INSUFFICIENT_DATA"],scores:{CALL:0,PUT:0}};
  const closes=candles.map(c=>c.close),e5=emaSeries(closes,5),e20=emaSeries(closes,20),i=candles.length-1;
  const atr=atrAt(candles,i),priorAtr=atrAt(candles,i-1),trs=trueRanges(candles),recentAtr=mean(trs.slice(-14));
  const priorAtrSamples=Array.from({length:Math.max(0,candles.length-28)},(_,k)=>atrAt(candles,14+k));
  const baselineAtr=median(priorAtrSamples.slice(-20)),slope5=e5[i]-e5[i-1],slope20=e20[i]-e20[i-1];
  const tangled=Math.abs(e5[i]-e20[i])<=Math.max(atr*0.12,1e-10);
  const flat=Math.abs(slope5)<=Math.max(atr*0.025,1e-10)&&Math.abs(slope20)<=Math.max(atr*0.025,1e-10);
  const er10=efficiencyRatio(closes.slice(-11),10),adx=adx14(candles),recent10=candles.slice(-10);
  const recentRange10=Math.max(...recent10.map(c=>c.high))-Math.min(...recent10.map(c=>c.low));
  const compressionChop=(er10<0.16&&priorAtr>0&&recentRange10<=priorAtr*2.5)||(adx<13&&er10<0.24);
  const choppy=(tangled&&flat)||compressionChop,currentRange=candles[i].high-candles[i].low;
  const atrSpike=(atr>0&&currentRange>atr*2.8)||(baselineAtr>0&&recentAtr>baselineAtr*2.4);
  const call=componentScore(candles,"CALL",e5,e20,atr),put=componentScore(candles,"PUT",e5,e20,atr);
  const qualities={CALL:call.quality,PUT:put.quality},scores={CALL:call.score,PUT:put.score};
  const direction=scores.CALL>scores.PUT?"CALL":scores.PUT>scores.CALL?"PUT":null;
  const top=direction?scores[direction]:Math.max(...Object.values(scores)),gap=direction?Math.abs(scores.CALL-scores.PUT):0;
  const chosen=direction==="PUT"?put:call,riskFlags=[];
  if(choppy)riskFlags.push("CHOPPY_MARKET_KILL_SWITCH");
  if(atrSpike)riskFlags.push("HIGH_ATR_SPIKE_KILL_SWITCH");
  if(direction&&chosen.quality.extension>1.65)riskFlags.push("OVEREXTENDED_ENTRY");
  if(direction&&gap<8)riskFlags.push("LOW_DIRECTIONAL_SEPARATION");
  if(direction&&chosen.quality.closeLocation<0.55)riskFlags.push("WEAK_ENTRY_CANDLE");
  let signal="STANDBY",status="STANDBY";
  if(!choppy&&!atrSpike&&direction&&chosen.quality.extension<=1.65&&gap>=8){
    if(top>=65){signal=direction;status="SIGNAL";}else if(top>=45){signal="PREPARE";status="PREPARE";}
  }
  const reason=choppy?"KILL SWITCH: ตลาดมีประสิทธิภาพทิศทางต่ำ/EMA พันกัน — STANDBY"
    :atrSpike?"KILL SWITCH: ATR/แท่งล่าสุดพุ่งผิดปกติ — STANDBY"
    :direction&&chosen.quality.extension>1.65?"ENTRY GUARD: ราคาไกล EMA5 เกิน 1.65 ATR — งดไล่ราคา"
    :direction&&gap<8?"ENTRY GUARD: คะแนน CALL/PUT ใกล้กันเกินไป — ทิศทางไม่ชัด"
    :signal==="CALL"||signal==="PUT"?"Partial Score "+top+"/100 · "+signal+" ผ่านเกณฑ์ 65 หลังหักคุณภาพแท่งเข้า"
    :signal==="PREPARE"?"PREPARE · "+direction+" "+top+"/100 · รอประเมินซ้ำที่ T-5"
    :"คะแนนสูงสุด "+top+"/100 ต่ำกว่าเกณฑ์ PREPARE 45 หรือคุณภาพแท่งเข้าไม่ผ่าน";
  return {signal,status,direction,score:top,confidence:top,scores,rawScores:{CALL:call.rawScore,PUT:put.rawScore},
    components:chosen.components,componentScores:{CALL:call.components,PUT:put.components},entryQuality:qualities,
    directionalGap:gap,reason,summary:reason,
    regime:choppy?"SIDEWAY":atrSpike?"HIGH_VOLATILITY":direction==="CALL"?"UPTREND":direction==="PUT"?"DOWNTREND":"UNCLEAR",
    strategy:"PARTIAL_SCORING_65_AGILE_ACCURACY_V2",provider:"LOCAL_PARTIAL_SCORING",riskFlags,
    evidence:[
      "CALL "+scores.CALL+"/100 · PUT "+scores.PUT+"/100",
      "EMA5 Slope "+chosen.components.ema5SlopeReversal+"/30 · S/R Fakeout "+chosen.components.srFakeout+"/30",
      "Proximity & Momentum "+chosen.components.proximityMomentum+"/20 · Trend Context "+chosen.components.trendContext+"/20",
      "Entry close-position "+round1(chosen.quality.closeLocation*100)+"% · body "+round1(chosen.quality.bodyRatio*100)+"% · extension "+round1(chosen.quality.extension)+" ATR",
      "Regime: ER10 "+round1(er10*100)+"% · ADX14 "+round1(adx)+" · EMA5/EMA20 "+(tangled?"พันกัน":"แยกตัว")+" · ATR "+(atrSpike?"ผิดปกติ":"ปกติ")
    ],
    metrics:{ema5:e5[i],ema20:e20[i],ema5Slope:slope5,ema20Slope:slope20,atr14:atr,priorAtr14:priorAtr,baselineAtr,
      emaTangled:tangled,slopesFlat:flat,nearEma5:chosen.details.nearEma5,efficiencyRatio10:er10,adx14:adx,recentRange10,
      entryExtensionAtr:chosen.quality.extension,entryCloseLocation:chosen.quality.closeLocation,entryBodyRatio:chosen.quality.bodyRatio},
    prepareSignal:signal==="PREPARE"?direction:null,killSwitch:choppy||atrSpike,
    thresholds:{signal:65,prepare:45,standbyBelow:45,minDirectionalGap:8,maxEntryExtensionAtr:1.65}
  };
}
