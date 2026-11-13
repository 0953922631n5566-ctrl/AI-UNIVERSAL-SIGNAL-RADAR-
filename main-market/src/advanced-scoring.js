const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
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

/**
 * Candle Color & Momentum Confirmation (isolated add-on).
 * Uses closed OHLC candles only; green/red is derived from close vs open.
 * This layer keeps ORIGINAL scoring weights; experiment entry threshold is 70 with PREPARE floor 45.
 */
export function analyzeCandleColorMomentum(candles, direction) {
  if (!Array.isArray(candles) || candles.length < 3 || !["CALL", "PUT"].includes(direction)) {
    return { ready: false, confirmed: false, reason: "ต้องมีแท่งปิดอย่างน้อย 3 แท่ง" };
  }
  const sign = direction === "CALL" ? 1 : -1;
  const sample = candles.slice(-3);
  const analyzed = sample.map(c => {
    const range = Math.max(c.high - c.low, 1e-12);
    const body = c.close - c.open;
    const doji = Math.abs(body) / range <= 0.02;
    return {
      color: doji ? "DOJI" : body > 0 ? "GREEN" : "RED",
      body: Math.abs(body),
      signedBody: body * sign,
      range,
      closeLocation: direction === "CALL" ? (c.close - c.low) / range : (c.high - c.close) / range
    };
  });
  const alignedColor = direction === "CALL" ? "GREEN" : "RED";
  const alignedCount = analyzed.filter(c => c.color === alignedColor).length;
  const opposingCount = analyzed.filter(c => c.color !== alignedColor && c.color !== "DOJI").length;
  const dojiCount = analyzed.filter(c => c.color === "DOJI").length;
  const totalRange = analyzed.reduce((sum, c) => sum + c.range, 0);
  const bodyMomentum = totalRange > 0
    ? analyzed.reduce((sum, c) => sum + c.signedBody, 0) / totalRange : 0;
  const last = analyzed.at(-1);
  const lastAligned = last.color === alignedColor ||
    (last.color === "DOJI" && last.closeLocation >= 0.58);
  const confirmed = alignedCount >= 2 && lastAligned &&
    bodyMomentum >= 0.04 && last.closeLocation >= 0.55;
  return {
    ready: true, direction, colors: analyzed.map(c => c.color),
    alignedCount, opposingCount, dojiCount,
    bodyMomentum: Math.round(bodyMomentum * 1000) / 1000,
    closeLocation: Math.round(last.closeLocation * 1000) / 1000,
    confirmed,
    reason: confirmed
      ? "สีแท่งเทียนและแรงปิด 3 แท่งยืนยันทิศทาง"
      : "สีแท่งเทียนหรือแรงปิด 3 แท่งยังไม่ยืนยันทิศทาง"
  };
}

export function applyCandleConfirmation(result, candles) {
  if (!result || !["CALL", "PUT"].includes(result.direction)) return result;
  const confirmation = analyzeCandleColorMomentum(candles, result.direction);
  const next = {
    ...result,
    candleConfirmation: confirmation,
    evidence: [...(result.evidence || []),
      `Candle Confirmation: ${confirmation.colors?.join("/") || "N/A"} · ${confirmation.confirmed ? "CONFIRMED" : "PENDING"}`]
  };
  if ((result.signal === "CALL" || result.signal === "PUT") && !confirmation.confirmed) {
    next.signal = "PREPARE";
    next.status = "PREPARE";
    next.prepareSignal = result.direction;
    next.riskFlags = [...(result.riskFlags || []), "CANDLE_CONFIRMATION_PENDING"];
    next.reason = `Candle Confirmation ยังไม่ผ่าน · คงคะแนนเดิม ${result.score}/100 และรอยืนยันแท่งถัดไป`;
    next.summary = next.reason;
  }
  return next;
}
function componentScore(candles, direction, ema5, ema20, atr) {
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
  const proximityScore=20*(0.55*near+0.45*momentum);
  const aboveEma5=c.close>ema5[i], belowEma5=c.close<ema5[i];
  const structureMove=bullish?c.close-candles[Math.max(0,i-5)].close:candles[Math.max(0,i-5)].close-c.close;
  const structure=clamp(structureMove/Math.max(atr*0.9,1e-10));
  const emaSupport=bullish?aboveEma5:belowEma5;
  const trendScore=20*(0.55*structure+0.45*(emaSupport?1:0.25));
  const components={
    ema5SlopeReversal:Math.round(slopeScore*10)/10,
    srFakeout:Math.round(fakeoutScore*10)/10,
    proximityMomentum:Math.round(proximityScore*10)/10,
    trendContext:Math.round(trendScore*10)/10
  };
  return {score:Math.round(Object.values(components).reduce((a,b)=>a+b,0)*10)/10,components,
    details:{slopeNorm,prevNorm,sweepDistance,wickRatio,nearEma5:distance<=0.35,ema5,ema20}};
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
  const currentRange=candles[i].high-candles[i].low;
  const atrSpike=(atr>0&&currentRange>atr*2.8)||(baselineAtr>0&&recentAtr>baselineAtr*2.4);
  const call=componentScore(candles,"CALL",e5,e20,atr);
  const put=componentScore(candles,"PUT",e5,e20,atr);
  const scores={CALL:call.score,PUT:put.score};
  const direction=scores.CALL>scores.PUT?"CALL":scores.PUT>scores.CALL?"PUT":null;
  const top=direction?scores[direction]:Math.max(...Object.values(scores));
  const gap=direction?Math.abs(scores.CALL-scores.PUT):0;
  const riskFlags=[];
  if(choppy)riskFlags.push("CHOPPY_MARKET_KILL_SWITCH");
  if(atrSpike)riskFlags.push("HIGH_ATR_SPIKE_KILL_SWITCH");
  let signal="STANDBY",status="STANDBY";
  if(!choppy&&!atrSpike&&direction){
    if(top>=70){signal=direction;status="SIGNAL";}
    else if(top>=45){signal="PREPARE";status="PREPARE";}
  }
  const chosen=direction==="PUT"?put:call;
  const reason=choppy?"KILL SWITCH: EMA5/EMA20 พันกันและความชันแบน — STANDBY"
    :atrSpike?"KILL SWITCH: ATR/แท่งล่าสุดพุ่งผิดปกติ — STANDBY"
    :signal==="CALL"||signal==="PUT"?`Partial Score ${top}/100 · ${signal} ผ่านเกณฑ์ 70`
    :signal==="PREPARE"?`PREPARE · ${direction} ${top}/100 · รอประเมินซ้ำที่ T-5`
    :`คะแนนสูงสุด ${top}/100 ต่ำกว่าเกณฑ์ PREPARE 45 หรือทิศทางยังไม่ชัด`;
  const result = {signal,status,direction,score:top,confidence:top,scores,components:chosen.components,
    componentScores:{CALL:call.components,PUT:put.components},reason,summary:reason,
    regime:choppy?"SIDEWAY":atrSpike?"HIGH_VOLATILITY":direction==="CALL"?"UPTREND":direction==="PUT"?"DOWNTREND":"UNCLEAR",
    strategy:"PARTIAL_SCORING_70_CANDLE_CONFIRMATION",provider:"LOCAL_PARTIAL_SCORING",riskFlags,
    evidence:[
      `CALL ${scores.CALL}/100 · PUT ${scores.PUT}/100`,
      `EMA5 Slope ${chosen.components.ema5SlopeReversal}/30 · S/R Fakeout ${chosen.components.srFakeout}/30`,
      `Proximity & Momentum ${chosen.components.proximityMomentum}/20 · Trend Context ${chosen.components.trendContext}/20`,
      `EMA5/EMA20 ${tangled?"พันกัน":"แยกตัว"} · ATR ${atrSpike?"ผิดปกติ":"ปกติ"}`
    ],
    metrics:{ema5:e5[i],ema20:e20[i],ema5Slope:slope5,ema20Slope:slope20,atr14:atr,baselineAtr,
      emaTangled:tangled,slopesFlat:flat,nearEma5:chosen.details.nearEma5},
    prepareSignal:signal==="PREPARE"?direction:null,killSwitch:choppy||atrSpike,
    thresholds:{signal:70,prepare:45,standbyBelow:45}
  };
  return applyCandleConfirmation(result, candles);
}
