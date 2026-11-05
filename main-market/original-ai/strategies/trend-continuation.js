'use strict';
function evaluateTrendContinuation(x,direction){
  const i=x?.indicators,c=x?.latest,p=x?.candles?.at(-2);
  const call=direction==='CALL',signal=call?'CALL':'PUT';
  if(!i||!c||!p)return{signal:'STANDBY',score:0,reason:'Missing trend context'};
  const range=Math.max(c.high-c.low,1e-12);
  const body=call?(c.close-c.open)/range:(c.open-c.close)/range;
  const closeStrength=call?(c.close-c.low)/range:(c.high-c.close)/range;
  const candleFlow=(call?c.close>c.open&&c.close>p.close:c.close<c.open&&c.close<p.close)&&body>=0.30&&closeStrength>=0.68;
  const diAligned=call?i.plusDI>i.minusDI:i.minusDI>i.plusDI;
  const macdAligned=call?i.macdHistogram>0:i.macdHistogram<0;
  const momentumAligned=diAligned&&macdAligned;
  const pullback=call?(c.low<=i.ema9||c.close<=i.ema9*1.0002):(c.high>=i.ema9||c.close>=i.ema9*.9998);
  const reclaim=call?(c.close>i.ema9&&c.close>c.open&&c.close>p.close):(c.close<i.ema9&&c.close<c.open&&c.close<p.close);
  const rsiAligned=call?i.rsi>=45&&i.rsi<=78:i.rsi>=22&&i.rsi<=55;
  const evidence=[i.adx>=18,diAligned,rsiAligned,macdAligned,candleFlow,pullback&&reclaim];
  const score=evidence.filter(Boolean).length*20,continuation=momentumAligned&&candleFlow;
  if(score>=60&&(continuation||pullback&&reclaim))return{signal,score:Math.min(100,score),reason:continuation?(call?'Strong bullish continuation candle':'Strong bearish continuation candle'):(call?'Uptrend pullback and bullish momentum confirmed':'Downtrend pullback and bearish momentum confirmed')};
  return{signal:'STANDBY',score,reason:call?'Uptrend entry confirmation incomplete':'Downtrend entry confirmation incomplete'};
}
module.exports={evaluateTrendContinuation};
