import { getAnalyzerTuning } from "./analyzer-control.js";
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
function valid(c) {
  return c && [c.epoch,c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    c.epoch >= 0 && c.low > 0 && c.high >= Math.max(c.open,c.close) &&
    c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function atr(rows, period=14) {
  const tr=rows.slice(1).map((c,i)=>Math.max(c.high-c.low,
    Math.abs(c.high-rows[i].close),Math.abs(c.low-rows[i].close)));
  return mean(tr.slice(-period));
}
function ema(values, period) {
  if (!values.length) return 0;
  const k=2/(period+1);
  return values.slice(1).reduce((v,x)=>x*k+v*(1-k),values[0]);
}

/**
 * Engine 4: first-30-second M1 pullback/bounce and spike/rejection continuation.
 * Trend up: detect a dip followed by a bullish turn => CALL.
 * Trend down: detect a pop followed by a bearish turn => PUT.
 * Uses the live forming candle; no candle-close confirmation is required.
 */
export function analyzeEarlyEntryEngine4(candles, options={}) {
  const tuning=getAnalyzerTuning(options.control);
  const minimum=Number.isInteger(options.minimumClosedCandles)?options.minimumClosedCandles:35;
  const rows=Array.isArray(candles)?candles.slice(-55):[];
  const live=rows.at(-1), closed=rows.slice(0,-1);
  const strategy="ENGINE_4_M1_PULLBACK_BOUNCE_SPIKE_REJECTION_0_30S";
  if(options.livePreview!==true || !live || (live.live!==true&&live.provisional!==true) ||
      !valid(live) || closed.length<minimum || !closed.every(c=>c.live!==true&&valid(c))) {
    return {ready:false,signal:null,candidateSignal:null,score:0,status:"NOT_READY",
      reason:`Engine 4 ต้องมีแท่งปิดอย่างน้อย ${minimum} แท่งและแท่ง M1 ปัจจุบันที่กำลังก่อตัว`,strategy};
  }
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const elapsed=now-live.epoch*1000;
  if(elapsed<0 || elapsed>=30000) return {ready:true,signal:null,candidateSignal:null,
    score:0,status:"ENTRY_WINDOW_CLOSED",candleEpoch:live.epoch,
    elapsedSeconds:Math.max(0,Math.floor(elapsed/1000)),strategy,
    reason:"Engine 4 ค้นหาจังหวะย่อ/ดีดเฉพาะ 30 วินาทีแรกของแท่ง M1"};
  const history=closed.slice(-50), prev=history.at(-1), volatility=atr(history);
  if(!(volatility>0)) return {ready:true,signal:null,candidateSignal:null,score:0,
    status:"VOLATILITY_NOT_READY",candleEpoch:live.epoch,strategy,
    reason:"ข้อมูล ATR ยังไม่พร้อมสำหรับประเมินการย่อตัว"};
  const closes=history.map(c=>c.close);
  const fast=ema(closes.slice(-20),5), slow=ema(closes.slice(-30),20);
  const trendGap=(fast-slow)/volatility;
  const trendUp=trendGap>=tuning.engine4TrendGapAtr && fast>slow && history.at(-1).close>=history.at(-4).close;
  const trendDown=trendGap<=-tuning.engine4TrendGapAtr && fast<slow && history.at(-1).close<=history.at(-4).close;
  const range=Math.max(live.high-live.low,Number.EPSILON);
  const body=live.close-live.open, closePos=(live.close-live.low)/range;
  const upper=(live.high-Math.max(live.open,live.close))/range;
  const lower=(Math.min(live.open,live.close)-live.low)/range;
  const recent=history.slice(-6);
  const swingHigh=Math.max(...recent.map(c=>c.high));
  const swingLow=Math.min(...recent.map(c=>c.low));
  const dipFromHigh=(swingHigh-live.low)/volatility;
  const popFromLow=(live.high-swingLow)/volatility;
  const pullbackCall=trendUp && dipFromHigh>=tuning.engine4MinPullbackAtr && dipFromHigh<=tuning.engine4MaxPullbackAtr &&
    live.close>live.open && closePos>=tuning.engine4CloseLocation && (lower>=tuning.engine4WickThreshold || live.close>prev.close);
  const pullbackPut=trendDown && popFromLow>=tuning.engine4MinPullbackAtr && popFromLow<=tuning.engine4MaxPullbackAtr &&
    live.close<live.open && closePos<=1-tuning.engine4CloseLocation && (upper>=tuning.engine4WickThreshold || live.close<prev.close);
  const continuationCall=trendUp && live.close>prev.close && closePos>=Math.min(.78,tuning.engine4CloseLocation+.13) &&
    live.close>live.open && (lower>=tuning.engine4WickThreshold+.02 || live.close>prev.high);
  const continuationPut=trendDown && live.close<prev.close && closePos<=1-Math.min(.78,tuning.engine4CloseLocation+.13) &&
    live.close<live.open && (upper>=tuning.engine4WickThreshold+.02 || live.close<prev.low);
  const callScore=Math.min(100,Math.round(30*Number(trendUp)+30*Number(pullbackCall)+
    25*Number(continuationCall)+15*Number(lower>=.08)));
  const putScore=Math.min(100,Math.round(30*Number(trendDown)+30*Number(pullbackPut)+
    25*Number(continuationPut)+15*Number(upper>=.08)));
  const score=Math.max(callScore,putScore);
  const abnormal=range>volatility*2.5;
  const base={ready:true,signal:null,candidateSignal:null,score,scoreUp:callScore,scoreDown:putScore,
    candleEpoch:live.epoch,elapsedSeconds:Math.floor(elapsed/1000),
    targetCandleAt:new Date(live.epoch*1000).toISOString(),strategy,
    regime:trendUp?"UPTREND_PULLBACK":trendDown?"DOWNTREND_BOUNCE":"NO_CLEAR_TREND",
    metrics:{atr:volatility,rangeAtr:+(range/volatility).toFixed(3),trendGapAtr:+trendGap.toFixed(3),
      closeLocation:+closePos.toFixed(3),upperWickRatio:+upper.toFixed(3),lowerWickRatio:+lower.toFixed(3),
      dipFromRecentHighAtr:+dipFromHigh.toFixed(3),popFromRecentLowAtr:+popFromLow.toFixed(3),
      trendUp,trendDown,pullbackCall,pullbackPut,continuationCall,continuationPut},
    evidence:[
      trendUp?"แนวโน้มหลักเป็นขาขึ้น":trendDown?"แนวโน้มหลักเป็นขาลง":"แนวโน้มหลักยังไม่ชัด",
      pullbackCall?"ย่อลงแล้วมีแรงซื้อกลับ":"ยังไม่ยืนยันจังหวะย่อลงแล้วเด้ง",
      pullbackPut?"ดีดขึ้นแล้วมีแรงขายกลับ":"ยังไม่ยืนยันจังหวะดีดขึ้นแล้วลง",
      abnormal?"งดสัญญาณ: ช่วงราคาเกิน 2.5 ATR":"ผ่านตัวกรองช่วงราคา"
    ]};
  if(abnormal)return {...base,status:"ABNORMAL_RANGE_BLOCK",reason:"แท่ง M1 ผันผวนผิดปกติ · งดเข้า"};
  if((pullbackCall||continuationCall)&&callScore>=tuning.engine4SignalThreshold&&callScore-putScore>=tuning.engine4DirectionalMargin)
    return {...base,signal:"CALL",candidateSignal:"CALL",score:callScore,status:pullbackCall?"PULLBACK_BOUNCE_CALL":"TREND_CONTINUATION_CALL",
      alertId:`ENGINE_4:${live.epoch}:CALL:PULLBACK`,
      reason:pullbackCall?"CALL · แนวโน้มขึ้น ย่อตัวแล้วมีแรงซื้อกลับ":"CALL · แนวโน้มขึ้นและแรงซื้อกลับมาต่อเนื่อง"};
  if((pullbackPut||continuationPut)&&putScore>=tuning.engine4SignalThreshold&&putScore-callScore>=tuning.engine4DirectionalMargin)
    return {...base,signal:"PUT",candidateSignal:"PUT",score:putScore,status:pullbackPut?"SPIKE_REJECTION_PUT":"TREND_CONTINUATION_PUT",
      alertId:`ENGINE_4:${live.epoch}:PUT:PULLBACK`,
      reason:pullbackPut?"PUT · แนวโน้มลง ดีดตัวขึ้นแล้วมีแรงขายกลับ":"PUT · แนวโน้มลงและแรงขายกลับมาต่อเนื่อง"};
  return {...base,status:score>=Math.max(5,tuning.engine4SignalThreshold-10)?"PULLBACK_WAIT_CONFIRMATION":"PULLBACK_STANDBY",
    reason:score>=50?"พบจังหวะย่อ/ดีด แต่ยังรอแรงกลับเข้าตามแนวโน้ม":"ยังไม่พบจังหวะย่อ/ดีดและแรงยืนยันที่ชัดเจน"};
}
