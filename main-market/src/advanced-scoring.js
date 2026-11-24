const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const median = xs => { if (!xs.length) return 0; const a=[...xs].sort((x,y)=>x-y); return a[Math.floor(a.length/2)]; };
const round = value => Math.round(value * 10) / 10;

function validateNativeIndicators(candles, indicators) {
  const last = candles.at(-1);
  const ema5 = indicators?.ema5 || [];
  const ema20 = indicators?.ema20 || [];
  const atr14 = indicators?.atr14 || [];
  const consecutive = (rows, field, count) => rows.length >= count &&
    rows.slice(-count).every((row,index,values) =>
      Number.isFinite(row?.epoch) && Number.isFinite(row?.[field]) && row[field] > 0 &&
      (index === 0 || row.epoch - values[index - 1].epoch === 60));
  const ema5Ready = consecutive(ema5,"ema",3);
  const ema20Ready = consecutive(ema20,"ema",2);
  const atrReady = consecutive(atr14,"atr",34);
  const epochsMatch = ema5Ready && ema20Ready && atrReady &&
    ema5.at(-1).epoch === last.epoch && ema20.at(-1).epoch === last.epoch &&
    atr14.at(-1).epoch === last.epoch;
  return {
    ready: ema5Ready && ema20Ready && atrReady && epochsMatch,
    status: !ema5Ready || !ema20Ready || !atrReady ? "WAITING"
      : !epochsMatch ? "STALE_OR_MISALIGNED" : "READY",
    ema5Ready, ema20Ready, atrReady, epochsMatch,
    required: { ema5: 3, ema20: 2, atr14: 34 },
    latestEpoch: last?.epoch ?? null
  };
}

export function classifyPartialScore(top,direction,killSwitch=false) {
  if(killSwitch||!direction)return {signal:"STANDBY",status:"STANDBY"};
  if(top>=54)return {signal:direction,status:"SIGNAL"};
  if(top>=45)return {signal:"PREPARE",status:"PREPARE"};
  return {signal:"STANDBY",status:"STANDBY"};
}

function componentScore(candles, direction, native) {
  const n=candles.length, i=n-1, c=candles[i], p=candles[i-1];
  const sign=direction==="CALL"?1:-1, bullish=sign===1;
  const ema5=native.ema5;
  const ema20=native.ema20;
  const slopeNow=ema5.at(-1).ema-ema5.at(-2).ema;
  const slopePrev=ema5.at(-2).ema-ema5.at(-3).ema;
  const slopeNorm=native.atr>0?sign*slopeNow/native.atr:0;
  const prevNorm=native.atr>0?sign*slopePrev/native.atr:0;
  const shift=clamp((slopeNorm+0.025)/0.10);
  const reversal=clamp((slopeNorm-prevNorm+0.02)/0.10);
  const slopeScore=30*(0.55*shift+0.45*reversal);

  const prior=candles.slice(-8,-2);
  const level=bullish?Math.min(...prior.map(x=>x.low)):Math.max(...prior.map(x=>x.high));
  const swept=bullish?Math.min(c.low,p.low):Math.max(c.high,p.high);
  const wick=bullish?Math.min(c.open,c.close)-c.low:c.high-Math.max(c.open,c.close);
  const range=Math.max(c.high-c.low,native.atr*0.02,1e-10);
  const reclaim=bullish?c.close>level:c.close<level;
  const sweepDistance=bullish?level-swept:swept-level;
  const wickRatio=wick/range;
  const sweepStrength=clamp(sweepDistance/Math.max(native.atr*0.12,1e-10));
  const wickStrength=clamp((wickRatio-0.12)/0.48);
  const reclaimStrength=reclaim?1:clamp(1-Math.abs(c.close-level)/Math.max(native.atr*0.25,1e-10));
  const fakeoutConfirmed=sweepDistance>0&&reclaim&&wickRatio>=0.35;
  const fakeoutScore=30*(fakeoutConfirmed?1:0.45*sweepStrength+0.35*wickStrength+0.20*reclaimStrength);

  const distance=native.atr>0?Math.abs(c.close-ema5.at(-1).ema)/native.atr:Infinity;
  const near=clamp(1-distance/0.70);
  const momentum=bullish?clamp((c.close-c.open+Math.max(0,c.close-p.close)*0.5)/Math.max(native.atr*0.35,1e-10))
    :clamp((c.open-c.close+Math.max(0,p.close-c.close)*0.5)/Math.max(native.atr*0.35,1e-10));
  const proximityScore=20*(0.55*near+0.45*momentum);
  const aboveEma5=c.close>ema5.at(-1).ema, belowEma5=c.close<ema5.at(-1).ema;
  const structureMove=bullish?c.close-candles[Math.max(0,i-5)].close:candles[Math.max(0,i-5)].close-c.close;
  const structure=clamp(structureMove/Math.max(native.atr*0.9,1e-10));
  const emaSupport=bullish?aboveEma5:belowEma5;
  const trendScore=20*(0.55*structure+0.45*(emaSupport?1:0.25));
  const components={
    ema5SlopeReversal:round(slopeScore),
    srFakeout:round(fakeoutScore),
    proximityMomentum:round(proximityScore),
    trendContext:round(trendScore)
  };
  return {score:round(Object.values(components).reduce((a,b)=>a+b,0)),components,
    details:{slopeNorm,prevNorm,sweepDistance,wickRatio,nearEma5:distance<=0.35}};
}

export function scoreMarket(candles, indicators) {
  if(!Array.isArray(candles)||candles.length<30||!candles.every(c=>c&&[c.open,c.high,c.low,c.close,c.epoch].every(Number.isFinite)))
    return {signal:"STANDBY",score:0,reason:"ข้อมูล OHLC ไม่เพียงพอ",riskFlags:["INSUFFICIENT_DATA"],scores:{CALL:0,PUT:0}};
  const validation=validateNativeIndicators(candles,indicators);
  if(!validation.ready) return {
    signal:"STANDBY",status:"INDICATORS_NOT_READY",score:0,confidence:0,
    reason:"รอ EMA5 / EMA20 / ATR14 จาก Twelve Data ให้ครบและตรงกับแท่ง M1 ล่าสุด",
    evidence:[],riskFlags:["NATIVE_INDICATORS_NOT_READY"],scores:{CALL:0,PUT:0},
    indicatorStatus:validation,provider:"TWELVE_DATA_NATIVE_INDICATORS"
  };

  const ema5=indicators.ema5.slice(-3), ema20=indicators.ema20.slice(-2);
  const atrRows=indicators.atr14.slice(-34);
  const atr=atrRows.at(-1).atr;
  const baselineAtr=median(atrRows.slice(0,20).map(x=>x.atr));
  const recentAtr=mean(atrRows.slice(-14).map(x=>x.atr));
  const i=candles.length-1;
  const slope5=ema5.at(-1).ema-ema5.at(-2).ema;
  const slope20=ema20.at(-1).ema-ema20.at(-2).ema;
  const tangled=Math.abs(ema5.at(-1).ema-ema20.at(-1).ema)<=Math.max(atr*0.12,1e-10);
  const flat=Math.abs(slope5)<=Math.max(atr*0.025,1e-10)&&Math.abs(slope20)<=Math.max(atr*0.025,1e-10);
  const choppy=tangled&&flat;
  const currentRange=candles[i].high-candles[i].low;
  const atrSpike=(atr>0&&currentRange>atr*2.8)||(baselineAtr>0&&recentAtr>baselineAtr*2.4);
  const native={ema5,ema20,atr};
  const call=componentScore(candles,"CALL",native);
  const put=componentScore(candles,"PUT",native);
  const scores={CALL:call.score,PUT:put.score};
  const direction=scores.CALL>scores.PUT?"CALL":scores.PUT>scores.CALL?"PUT":null;
  const top=direction?scores[direction]:Math.max(...Object.values(scores));
  const riskFlags=[];
  if(choppy)riskFlags.push("CHOPPY_MARKET_KILL_SWITCH");
  if(atrSpike)riskFlags.push("HIGH_ATR_SPIKE_KILL_SWITCH");
  const decision=classifyPartialScore(top,direction,choppy||atrSpike);
  const {signal,status}=decision;
  const chosen=direction==="PUT"?put:call;
  const reason=choppy?"KILL SWITCH: EMA5/EMA20 พันกันและความชันแบน — STANDBY"
    :atrSpike?"KILL SWITCH: ATR/แท่งล่าสุดพุ่งผิดปกติ — STANDBY"
    :signal==="CALL"||signal==="PUT"?`Partial Score ${top}/100 · ${signal} ผ่านเกณฑ์ 54`
    :signal==="PREPARE"?`PREPARE · ${direction} ${top}/100 · รอประเมินซ้ำที่ T-5`
    :`คะแนนสูงสุด ${top}/100 ต่ำกว่าเกณฑ์ PREPARE 45 หรือทิศทางยังไม่ชัด`;
  return {signal,status,direction,score:top,confidence:top,scores,components:chosen.components,
    componentScores:{CALL:call.components,PUT:put.components},reason,summary:reason,
    regime:choppy?"SIDEWAY":atrSpike?"HIGH_VOLATILITY":direction==="CALL"?"UPTREND":direction==="PUT"?"DOWNTREND":"UNCLEAR",
    strategy:"TWELVE_DATA_NATIVE_PARTIAL_SCORING_54",provider:"TWELVE_DATA_NATIVE_INDICATORS",
    riskFlags,evidence:[
      `CALL ${scores.CALL}/100 · PUT ${scores.PUT}/100`,
      `EMA5 Slope ${chosen.components.ema5SlopeReversal}/30 · S/R Fakeout ${chosen.components.srFakeout}/30`,
      `Proximity & Momentum ${chosen.components.proximityMomentum}/20 · Trend Context ${chosen.components.trendContext}/20`,
      `EMA5/EMA20 ${tangled?"พันกัน":"แยกตัว"} · ATR ${atrSpike?"ผิดปกติ":"ปกติ"}`,
      "EMA5, EMA20 และ ATR14 คำนวณโดย Twelve Data · OHLC ใช้เฉพาะโครงสร้างราคาและแท่งเทียน"
    ],
    metrics:{ema5:ema5.at(-1).ema,ema20:ema20.at(-1).ema,ema5Slope:slope5,ema20Slope:slope20,atr14:atr,baselineAtr,
      emaTangled:tangled,slopesFlat:flat,nearEma5:chosen.details.nearEma5},
    indicatorStatus:{status:"READY",ema5:"READY",ema20:"READY",atr14:"READY",
      sources:{ema5:"Twelve Data /ema time_period=5",ema20:"Twelve Data /ema time_period=20",atr14:"Twelve Data /atr time_period=14"},
      periods:{ema5:5,ema20:20,atr14:14},latestEpoch:validation.latestEpoch},
    prepareSignal:signal==="PREPARE"?direction:null,killSwitch:choppy||atrSpike,
    thresholds:{signal:54,prepare:45,standbyBelow:45}
  };
}
