'use strict';
function evaluateDowntrend(x){
  const i=x.indicators,c=x.latest,p=x.candles.at(-2);
  if(!i||!c||!p)return{signal:'STANDBY',score:0,reason:'Missing trend context'};
  const range=Math.max(c.high-c.low,1e-12),body=(c.open-c.close)/range;
  const pullback=c.high>=i.ema9||c.close>=i.ema9*.9998;
  const reject=c.close<i.ema9&&c.close<c.open&&c.close<p.close;
  const candleFlow=c.close<c.open&&c.close<p.close&&body>=0.35;
  const aligned=i.minusDI>i.plusDI&&i.macdHistogram<0;
  const continuation=aligned&&candleFlow;
  const evidence=[
    i.adx>=18,
    i.minusDI>i.plusDI,
    i.rsi>=24&&i.rsi<=55,
    i.macdHistogram<0,
    candleFlow,
    pullback&&reject
  ];
  const n=evidence.filter(Boolean).length;
  if(n>=3&&(pullback&&reject||continuation)){
    return{signal:'PUT',score:Math.min(100,n*20),reason:continuation?'Strong bearish trend continuation':'Downtrend pullback and bearish momentum confirmed'};
  }
  return{signal:'STANDBY',score:n*20,reason:'Downtrend entry confirmation incomplete'};
}
module.exports={evaluateDowntrend};
