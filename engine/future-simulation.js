'use strict';
const { adx } = require('../indicators/adx');
const { ROUND16 } = require('./round16-parameters');
const LOOKBACK=5, ATR_PERIOD=14, MIN_ANALOGS=20, MAX_ANALOGS=30, MIN_DIRECTIONAL_RATE=0.58, EPSILON=1e-12;
function trueRange(c,p){return Math.max(c.high-c.low,Math.abs(c.high-p),Math.abs(c.low-p));}
function atrAt(c,end,n=ATR_PERIOD){if(end<n)return null;let s=0;for(let i=end-n+1;i<=end;i++)s+=trueRange(c[i],c[i-1].close);return s/n;}
function normalizedPattern(c,end,atr){const a=[];for(let i=end-LOOKBACK+1;i<=end;i++)a.push((c[i].close-c[i-1].close)/Math.max(atr,EPSILON));return a;}
function distance(a,b){let s=0;for(let i=0;i<a.length;i++)s+=(a[i]-b[i])**2;return Math.sqrt(s/a.length);}
function median(a){const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}

/**
 * Walk-forward historical analogue model. Finds similar five-candle paths
 * in earlier closed M1 candles and measures the next actual historical close.
 * It is an empirical scenario estimate, not a deterministic future-price claim.
 */
function simulateNextCandle(candles,analysis={}){
  if(!Array.isArray(candles)||candles.length<80)return{ready:false,status:'INSUFFICIENT_HISTORY',reason:'Need at least 80 closed historical M1 candles'};
  const latest=candles.at(-1);
  if(!latest||!Number.isFinite(latest.time)||candles.some((c,i)=>!c||![c.open,c.high,c.low,c.close,c.time].every(Number.isFinite)||c.high<c.low||(i>0&&c.time<=candles[i-1].time)))
    return{ready:false,status:'INVALID_HISTORY',reason:'Historical candle series is invalid or not chronological'};
  const currentAtr=atrAt(candles,candles.length-1),d=adx(candles),ind=analysis.indicators||{};
  if(!Number.isFinite(currentAtr)||currentAtr<=0||!Number.isFinite(d?.adx)||!Number.isFinite(ind.volatilityRatio))
    return{ready:false,status:'INDICATORS_NOT_READY',reason:'ATR, ADX, or volatility calculation is unavailable'};
  const query=normalizedPattern(candles,candles.length-1,currentAtr),analogues=[];
  for(let end=ATR_PERIOD+LOOKBACK;end<candles.length-1;end++){
    const atr=atrAt(candles,end);if(!Number.isFinite(atr)||atr<=0)continue;
    analogues.push({distance:distance(query,normalizedPattern(candles,end,atr)),futureReturnAtr:(candles[end+1].close-candles[end].close)/atr});
  }
  analogues.sort((a,b)=>a.distance-b.distance);
  const selected=analogues.slice(0,MAX_ANALOGS);
  if(selected.length<MIN_ANALOGS)return{ready:false,status:'INSUFFICIENT_ANALOGUES',reason:'Fewer than 20 comparable historical outcomes'};
  const ups=selected.filter(x=>x.futureReturnAtr>0),downs=selected.filter(x=>x.futureReturnAtr<0);
  const probabilityUp=ups.length/selected.length,probabilityDown=downs.length/selected.length;
  const expectedMoveAtr=selected.reduce((s,x)=>s+x.futureReturnAtr,0)/selected.length;
  const signal=probabilityUp>=MIN_DIRECTIONAL_RATE&&expectedMoveAtr>0?'CALL':
    probabilityDown>=MIN_DIRECTIONAL_RATE&&expectedMoveAtr<0?'PUT':'STANDBY';
  const riskScore=signal==='CALL'?probabilityDown:signal==='PUT'?probabilityUp:Math.max(probabilityUp,probabilityDown);
  const rangeAtrRatio=(latest.high-latest.low)/currentAtr,volatilityRatio=ind.volatilityRatio;
  const issues=[];
  if(signal==='STANDBY')issues.push('Historical analogues show no sufficient directional edge');
  if(riskScore>ROUND16.riskMax)issues.push('Historical adverse-outcome risk exceeds Round 16 limit');
  if(volatilityRatio>ROUND16.volatilityRatioMax)issues.push('Current volatility ratio exceeds Round 16 limit');
  if(d.adx<ROUND16.weakAdxMin)issues.push('ADX is below Round 16 minimum');
  if(rangeAtrRatio>ROUND16.rangeAtrRatioMax)issues.push('Current candle range exceeds Round 16 Range/ATR limit');
  return{ready:true,status:'READY',signal,candleTime:latest.time,riskScore,volatilityRatio,adx:d.adx,rangeAtrRatio,
    sampleCount:selected.length,probabilityUp,probabilityDown,expectedMoveAtr,
    medianMoveAtr:median(selected.map(x=>x.futureReturnAtr)),nearestAnalogueDistance:selected[0].distance,
    horizonCandles:1,model:'HISTORICAL_ANALOGUE_WALK_FORWARD',
    reason:issues.join('; ')||'Historical analogues support direction; awaiting Decision Engine agreement'};
}
module.exports={simulateNextCandle,atrAt,normalizedPattern};
