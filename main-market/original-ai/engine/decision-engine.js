'use strict';
const MIN_SCORE=60;

function hasStrongTrendMomentum(ctx,candidate){
  const i=ctx?.indicators;
  if(!i||!candidate||!['UPTREND','DOWNTREND'].includes(candidate.strategy)||i.adx<20)return false;
  if(candidate.signal==='CALL')return i.plusDI>i.minusDI&&i.macdHistogram>0&&i.rsi>=22&&i.rsi<=78;
  if(candidate.signal==='PUT')return i.minusDI>i.plusDI&&i.macdHistogram<0&&i.rsi>=22&&i.rsi<=78;
  return false;
}

function withAssistant(result,ctx){
  const assistant=ctx?.assistant;
  if(!assistant)return result;
  const historical=assistant.historicalDirection;
  const alignment=['CALL','PUT'].includes(result.signal)&&['CALL','PUT'].includes(historical)
    ? result.signal===historical?'AGREES':'CONFLICTS'
    : 'NO_COMPARISON';
  return {
    ...result,
    assistantAlignment:alignment,
    assistantHistoricalDirection:historical||'INSUFFICIENT_SAMPLE'
  };
}

function decide(ctx,candidate){
  if(!ctx||ctx.regime==='UNCLEAR'||!ctx.indicators)return withAssistant({signal:'STANDBY',regime:ctx?.regime||'UNCLEAR',score:0,reason:ctx?.reason||'Market context unavailable',strategy:'NONE'},ctx);
  if(!candidate||!['CALL','PUT'].includes(candidate.signal)||candidate.score<MIN_SCORE)return withAssistant({signal:'STANDBY',regime:ctx.regime,score:candidate?.score||0,reason:candidate?.reason||'No valid strategy candidate',strategy:candidate?.strategy||ctx.regime},ctx);
  const i=ctx.indicators,strongMomentum=hasStrongTrendMomentum(ctx,candidate);
  if(i.volatilityRatio>2.8||i.volatilityRatio>2.2&&!strongMomentum)return withAssistant({signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Extreme volatility; entry blocked',strategy:candidate.strategy},ctx);
  if(candidate.strategy==='UPTREND'&&candidate.signal==='CALL'&&i.nearResistance&&!(strongMomentum&&candidate.score>=MIN_SCORE))return withAssistant({signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Resistance nearby; bullish continuation not strong enough',strategy:candidate.strategy},ctx);
  if(candidate.strategy==='DOWNTREND'&&candidate.signal==='PUT'&&i.nearSupport&&!(strongMomentum&&candidate.score>=MIN_SCORE))return withAssistant({signal:'STANDBY',regime:ctx.regime,score:candidate.score,reason:'Support nearby; bearish continuation not strong enough',strategy:candidate.strategy},ctx);
  return withAssistant({...candidate,regime:ctx.regime},ctx);
}

module.exports={decide,MIN_SCORE,hasStrongTrendMomentum};
