import { calculateKamaDmiAdx, directionalConfirmation } from "./kama-dmi-adx.js";
import { calculateRsiBollinger, priceActionConfirmation } from "./rsi-bollinger.js";
import { calculateStructureCandleContext } from "./bos-choch-candle.js";

const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const SIGNAL_THRESHOLD = 60;
const PREPARE_THRESHOLD = 40;
function emaSeries(values, period) {
  const k=2/(period+1); let v=values[0]; const out=[v];
  for(let i=1;i<values.length;i++){v=values[i]*k+v*(1-k);out.push(v);}
  return out;
}
function trueRanges(candles) {
  return candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
}
function median(xs){if(!xs.length)return 0;const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];}
function atrAt(candles,end,period=14){
  const part=candles.slice(Math.max(0,end-period),end+1);
  const trs=part.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-part[i].close),Math.abs(c.low-part[i].close)));
  return mean(trs);
}
function componentScore(candles, direction, ema5, ema20, atr, indicators, priceIndicators) {
  const n=candles.length, i=n-1, c=candles[i], p=candles[i-1], p2=candles[i-2];
  const sign=direction==="CALL"?1:-1, bullish=sign===1;
  const slopeNow=ema5[i]-ema5[i-1], slopePrev=ema5[i-1]-ema5[i-2];
  const slopeNorm=atr>0?sign*slopeNow/atr:0;
  const prevNorm=atr>0?sign*slopePrev/atr:0;
  const shift=clamp((slopeNorm+0.025)/0.10);
  const reversal=clamp((slopeNorm-prevNorm+0.02)/0.10);
  const slopeScore=30*(0.55*shift+0.45*reversal);
  const prior=candles.slice(-8,-2);
  const level=bullish?Math.min(...prior.map(x=>x.low)):Math.max(...prior.map(x=>x.high));
  const swept=bullish?Math.min(c.low,p.low):Math.max(c.high,p.high);
  const wick=bullish?Math.min(c.open,c.close)-c.low:c.high-Math.max(c.open,c.close);
  const range=Math.max(c.high-c.low,atr*0.02,1e-10);
  const reclaim=bullish?c.close>level:c.close<level;
  const sweepDistance=bullish?level-swept:swept-level;
  const wickRatio=wick/range;
  const sweepStrength=clamp(sweepDistance/Math.max(atr*0.12,1e-10));
  const wickStrength=clamp((wickRatio-0.12)/0.48);
  const reclaimStrength=reclaim?1:clamp(1-Math.abs(c.close-level)/Math.max(atr*0.25,1e-10));
  const fakeoutConfirmed=sweepDistance>0&&reclaim&&wickRatio>=0.35;
  const fakeoutScore=30*(fakeoutConfirmed?1:0.45*sweepStrength+0.35*wickStrength+0.20*reclaimStrength);
  const distance=atr>0?Math.abs(c.close-ema5[i])/atr:Infinity;
  const near=clamp(1-distance/0.70);
  const momentum=bullish?clamp((c.close-c.open+Math.max(0,c.close-p.close)*0.5)/Math.max(atr*0.35,1e-10))
    :clamp((c.open-c.close+Math.max(0,p.close-c.close)*0.5)/Math.max(atr*0.35,1e-10));
  const priceConfirmation=priceActionConfirmation(priceIndicators,direction);
  const proximityScore=20*(0.40*near+0.30*momentum+0.15*priceConfirmation.rsi+0.15*priceConfirmation.bollinger);
  const aboveEma5=c.close>ema5[i], belowEma5=c.close<ema5[i];
  const structureMove=bullish?c.close-candles[Math.max(0,i-5)].close:candles[Math.max(0,i-5)].close-c.close;
  const structure=clamp(structureMove/Math.max(atr*0.9,1e-10));
  const emaSupport=bullish?aboveEma5:belowEma5;
  const confirmation=directionalConfirmation(indicators,direction);
  const trendScore=20*(0.35*structure+0.20*(emaSupport?1:0.25)+0.25*confirmation.kama+0.20*confirmation.dmi);
  const components={
    ema5SlopeReversal:Math.round(slopeScore*10)/10,
    srFakeout:Math.round(fakeoutScore*10)/10,
    proximityMomentum:Math.round(proximityScore*10)/10,
    trendContext:Math.round(trendScore*10)/10
  };
  return {score:Math.round(Object.values(components).reduce((a,b)=>a+b,0)*10)/10,components,
    details:{slopeNorm,prevNorm,sweepDistance,wickRatio,nearEma5:distance<=0.35,ema5,ema20,
      kama:indicators.kama,plusDI:indicators.plusDI,minusDI:indicators.minusDI,adx:indicators.adx,confirmation,
      rsi:priceIndicators.rsi,bbPercentB:priceIndicators.percentB,priceConfirmation}};
}
export function scoreMarket(candles) {
  if(!Array.isArray(candles)||candles.length<30||!candles.every(c=>c&&[c.open,c.high,c.low,c.close].every(Number.isFinite)))
    return {signal:"STANDBY",score:0,reason:"ข้อมูล OHLC ไม่เพียงพอ",riskFlags:["INSUFFICIENT_DATA"],scores:{CALL:0,PUT:0}};
  const closes=candles.map(c=>c.close), e5=emaSeries(closes,5), e20=emaSeries(closes,20), i=candles.length-1;
  const atr=atrAt(candles,i), trs=trueRanges(candles), recentAtr=mean(trs.slice(-14));
  const priorAtrSamples=Array.from({length:Math.max(0,candles.length-28)},(_,k)=>atrAt(candles,14+k));
  const baselineAtr=median(priorAtrSamples.slice(-20));
  const slope5=e5[i]-e5[i-1], slope20=e20[i]-e20[i-1];
  const tangled=Math.abs(e5[i]-e20[i])<=Math.max(atr*0.12,1e-10);
  const flat=Math.abs(slope5)<=Math.max(atr*0.025,1e-10)&&Math.abs(slope20)<=Math.max(atr*0.025,1e-10);
  const choppy=tangled&&flat;
  const recentDirections=candles.slice(-13).map(c=>Math.sign(c.close-c.open)).filter(v=>v!==0);
  const directionChanges=recentDirections.slice(1).reduce((n,v,i)=>n+(v!==recentDirections[i]?1:0),0);
  const alternationRatio=recentDirections.length>1?directionChanges/(recentDirections.length-1):0;
  const recentCloses=candles.slice(-15).map(c=>c.close);
  const pathLength=recentCloses.slice(1).reduce((sum,v,i)=>sum+Math.abs(v-recentCloses[i]),0);
  const efficiencyRatio=pathLength>0?Math.abs(recentCloses.at(-1)-recentCloses[0])/pathLength:0;
  const choppyScore=(tangled?25:0)+(flat?25:0)+(alternationRatio>=0.60?25:0)+(efficiencyRatio<=0.20?25:0);
  const choppyDanger=choppyScore>=75&&tangled&&flat&&alternationRatio>=0.70&&efficiencyRatio<=0.18;
  const choppyLevel=choppyDanger?"DANGER":choppyScore>=50?"WATCH":"NORMAL";

  const currentRange=candles[i].high-candles[i].low;
  const currentRangeRatio=atr>0?currentRange/atr:0;
  const recentAtrRatio=baselineAtr>0?recentAtr/baselineAtr:0;
  // WATCH begins before the original hard limits; DANGER retains the original kill-switch limits.
  const atrDanger=(atr>0&&currentRange>atr*2.8)||(baselineAtr>0&&recentAtr>baselineAtr*2.4);
  const atrWatch=!atrDanger&&((atr>0&&currentRangeRatio>=1.8)||(baselineAtr>0&&recentAtrRatio>=1.6));
  const atrLevel=atrDanger?"DANGER":atrWatch?"WATCH":"NORMAL";
  const guardLevel=choppyLevel==="DANGER"||atrLevel==="DANGER"?"DANGER"
    :choppyLevel==="WATCH"||atrLevel==="WATCH"?"WATCH":"NORMAL";
  const blocked=guardLevel==="DANGER";

  const indicators=calculateKamaDmiAdx(candles);
  const priceIndicators=calculateRsiBollinger(candles);
  const structureCandle=calculateStructureCandleContext(candles);
  const call=componentScore(candles,"CALL",e5,e20,atr,indicators,priceIndicators);
  const put=componentScore(candles,"PUT",e5,e20,atr,indicators,priceIndicators);
  const scores={CALL:call.score,PUT:put.score};
  const direction=scores.CALL>scores.PUT?"CALL":scores.PUT>scores.CALL?"PUT":null;
  const top=direction?scores[direction]:Math.max(...Object.values(scores));
  const riskFlags=[];
  if(choppyLevel==="DANGER")riskFlags.push("CHOPPY_MARKET_KILL_SWITCH");
  else if(choppyLevel==="WATCH")riskFlags.push("CHOPPY_MARKET_WATCH");
  if(atrLevel==="DANGER")riskFlags.push("HIGH_ATR_SPIKE_KILL_SWITCH");
  else if(atrLevel==="WATCH")riskFlags.push("HIGH_ATR_WATCH");
  let signal="STANDBY",status="STANDBY";
  if(!blocked&&direction){
    if(top>=SIGNAL_THRESHOLD){signal=direction;status="SIGNAL";}
    else if(top>=PREPARE_THRESHOLD){signal="PREPARE";status="PREPARE";}
  }
  const chosen=direction==="PUT"?put:call;
  // Keep the original signal and scores as an explicit baseline while new diagnostics run in shadow mode.
  const shadowBaselineSignal=signal;
  const shadowBaselineScores={...scores};
  const watchNote=guardLevel==="WATCH"?" · เฝ้าระวังความเสี่ยง Choppy/ATR (ยังไม่บล็อกสัญญาณ)":"";
  const reason=blocked&&choppyLevel==="DANGER"?"DANGER GUARD: ตลาดแกว่งสลับทิศรุนแรง — ระงับสัญญาณ"
    :blocked&&atrLevel==="DANGER"?"DANGER GUARD: ความผันผวน ATR รุนแรงผิดปกติ — ระงับสัญญาณ"
    :signal==="CALL"||signal==="PUT"?`Partial Score ${top}/100 · ${signal} ผ่านเกณฑ์ ${SIGNAL_THRESHOLD}${watchNote}`
    :signal==="PREPARE"?`PREPARE · ${direction} ${top}/100 · เกณฑ์ PREPARE ${PREPARE_THRESHOLD} · รอประเมินซ้ำที่ T-5${watchNote}`
    :`คะแนนสูงสุด ${top}/100 ต่ำกว่าเกณฑ์ PREPARE ${PREPARE_THRESHOLD} หรือทิศทางยังไม่ชัด${watchNote}`;
  return {signal,status,direction,score:top,confidence:top,scores,components:chosen.components,
    componentScores:{CALL:call.components,PUT:put.components},reason,summary:reason,
    regime:choppyLevel==="DANGER"?"SIDEWAY":atrLevel==="DANGER"?"HIGH_VOLATILITY":direction==="CALL"?"UPTREND":direction==="PUT"?"DOWNTREND":"UNCLEAR",
    strategy:"ORIGINAL_84_KAMA_DMI_ADX_RSI_BOLLINGER_BOS_CHOCH_CANDLE_SHADOW",provider:"LOCAL_PARTIAL_SCORING_ORIGINAL_84_KAMA_DMI_ADX_RSI_BOLLINGER_BOS_CHOCH_CANDLE_SHADOW",riskFlags,
    shadowBaselineSignal,shadowBaselineScores,
    structureCandle,
    evidence:[
      `CALL ${scores.CALL}/100 · PUT ${scores.PUT}/100`,
      `EMA5 Slope ${chosen.components.ema5SlopeReversal}/30 · S/R Fakeout ${chosen.components.srFakeout}/30`,
      `Proximity & Momentum ${chosen.components.proximityMomentum}/20 · Trend Context ${chosen.components.trendContext}/20`,
      `KAMA ${indicators.ready?(indicators.kamaRising?"UP":indicators.kamaFalling?"DOWN":"FLAT"):"N/A"} · +DI ${indicators.plusDI?.toFixed(1)??"N/A"} / -DI ${indicators.minusDI?.toFixed(1)??"N/A"} · ADX ${indicators.adx?.toFixed(1)??"N/A"}`,
      `RSI ${priceIndicators.rsi?.toFixed(1)??"N/A"} · BB %B ${priceIndicators.percentB?.toFixed(2)??"N/A"} · BB ${priceIndicators.squeeze?"SQUEEZE":"NORMAL"}`,
      `EMA5/EMA20 ${tangled?"พันกัน":"แยกตัว"} · ATR ${atrDanger?"อันตราย":atrWatch?"เฝ้าระวัง":"ปกติ"}`,
      `Choppy ${choppyLevel} (${choppyScore}/100) · ATR Guard ${atrLevel} · Overall ${guardLevel}`
    ],
    metrics:{ema5:e5[i],ema20:e20[i],ema5Slope:slope5,ema20Slope:slope20,atr14:atr,baselineAtr,
      emaTangled:tangled,slopesFlat:flat,nearEma5:chosen.details.nearEma5,
      choppyScore,alternationRatio,efficiencyRatio,currentRangeRatio,recentAtrRatio,
      kama:indicators.kama,kamaRising:indicators.kamaRising,kamaFalling:indicators.kamaFalling,
      plusDI:indicators.plusDI,minusDI:indicators.minusDI,adx:indicators.adx,adxStrength:indicators.adxStrength,
      callKamaAligned:indicators.callKamaAligned,putKamaAligned:indicators.putKamaAligned,
      callDmiAligned:indicators.callDmiAligned,putDmiAligned:indicators.putDmiAligned,
      rsi:priceIndicators.rsi,rsiPrevious:priceIndicators.previousRsi,rsiRising:priceIndicators.rsiRising,
      bbMiddle:priceIndicators.middle,bbUpper:priceIndicators.upper,bbLower:priceIndicators.lower,
      bbPercentB:priceIndicators.percentB,bbBandwidth:priceIndicators.bandwidth,
      marketStructureBias:structureCandle.bias,marketStructureEvent:structureCandle.event,
      structureSwingHigh:structureCandle.swingHigh,structureSwingLow:structureCandle.swingLow,
      candlePattern:structureCandle.candlePattern,candleBodyRatio:structureCandle.bodyRatio,
      candleUpperWickRatio:structureCandle.upperWickRatio,candleLowerWickRatio:structureCandle.lowerWickRatio,
      callStructureConflict:structureCandle.callStructureConflict,putStructureConflict:structureCandle.putStructureConflict,
      callCandleConflict:structureCandle.callCandleConflict,putCandleConflict:structureCandle.putCandleConflict,
      bbBandwidthRatio:priceIndicators.bandwidthRatio,bbSqueeze:priceIndicators.squeeze,
      callRsiAligned:priceIndicators.callRsiAligned,putRsiAligned:priceIndicators.putRsiAligned,
      callBollingerAligned:priceIndicators.callBollingerAligned,putBollingerAligned:priceIndicators.putBollingerAligned},
    riskGuard:{
      level:guardLevel,blocked,
      choppy:{level:choppyLevel,score:choppyScore,alternationRatio,efficiencyRatio,emaTangled:tangled,slopesFlat:flat},
      atr:{level:atrLevel,currentRangeRatio,recentAtrRatio},
    },
    prepareSignal:signal==="PREPARE"?direction:null,killSwitch:blocked,
    thresholds:{signal:SIGNAL_THRESHOLD,prepare:PREPARE_THRESHOLD,standbyBelow:PREPARE_THRESHOLD}
  };
}
