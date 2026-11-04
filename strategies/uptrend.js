'use strict';
function evaluateUptrend(x){
  const i=x.indicators,c=x.latest,p=x.candles.at(-2);
  if(!i||!c||!p)return{signal:'STANDBY',score:0,reason:'Missing trend context'};
  const range=Math.max(c.high-c.low,1e-12),body=(c.close-c.open)/range;
  const pullback=c.low<=i.ema9||c.close<=i.ema9*1.0002;
  const reclaim=c.close>i.ema9&&c.close>c.open&&c.close>p.close;
  const candleFlow=c.close>c.open&&c.close>p.close&&body>=0.35;
  const aligned=i.plusDI>i.minusDI&&i.macdHistogram>0;
  const continuation=aligned&&candleFlow;
  const evidence=[
    i.adx>=18,
    i.plusDI>i.minusDI,
    i.rsi>=45&&i.rsi<=76,
    i.macdHistogram>0,
    candleFlow,
    pullback&&reclaim
  ];
  const n=evidence.filter(Boolean).length;
  if(n>=3&&(pullback&&reclaim||continuation)){
    return{signal:'CALL',score:Math.min(100,n*20),reason:continuation?'Strong bullish trend continuation':'Uptrend pullback and bullish momentum confirmed'};
  }
  return{signal:'STANDBY',score:n*20,reason:'Uptrend entry confirmation incomplete'};
}
module.exports={evaluateUptrend};
