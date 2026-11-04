'use strict';
const MIN_SCORE=60;
function hasStrongTrendMomentum(ctx,candidate){
  const i=ctx?.indicators;
  if(!i||!candidate||candidate.strategy==='SIDEWAY'||candidate.strategy==='REVERSAL')return false;
  if(i.adx<24)return false;
  if(candidate.signal==='CALL')return i.plusDI>i.minusDI&&i.macdHistogram>0&&i.rsi<78;
  if(candidate.signal==='PUT')return i.minusDI>i.plusDI&&i.macdHistogram<0&&i.rsi>22;
  return false;
}
function decide(ctx,candidate){
  if(!ctx||ctx.regime==='UNCLEAR'||!ctx.indicators)return{signal:'STANDBY',regime:ctx?.regime||'UNCLEAR',score:0,reason:ctx?.reason||'Market context unavailable',strategy:'NONE'};
  if(!candidate||!['CALL','PUT'].includes(candidate.signal)||candidate.score<MIN_SCORE)return{signal:'STANDBY',regime:ctx.regime,score:candidate?.score||0,reason:candidate?.reason||'No valid strategy candidate',strategy:candidate?.strategy||ctx.regime};
  const i=ctx.indicators,strongMomentum=hasStrongTrendMomentum(ctx,candidate);
  if(i.volatilityRatio>2.8||i.volatilityRatio>2.2&&!strongMomentum)return{signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Extreme volatility; entry blocked',strategy:candidate.strategy};
  // Short-term S/R is a soft filter in an established trend: strong aligned momentum may continue through the nearby level.
  if(candidate.strategy!=='SIDEWAY'&&candidate.signal==='CALL'&&i.nearResistance&&!(strongMomentum&&candidate.score>=80))return{signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Resistance nearby; trend confirmation not strong enough',strategy:candidate.strategy};
  if(candidate.strategy!=='SIDEWAY'&&candidate.signal==='PUT'&&i.nearSupport&&!(strongMomentum&&candidate.score>=80))return{signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Support nearby; trend confirmation not strong enough',strategy:candidate.strategy};
  return{...candidate,regime:ctx.regime};
}
module.exports={decide,MIN_SCORE,hasStrongTrendMomentum};
