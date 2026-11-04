'use strict';
const express = require('express');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SYMBOL = 'EUR/USD';
const INTERVAL = '1min';
const API_BASE = 'https://api.twelvedata.com/time_series';
const CACHE_MS = 15000;
const MAX_CANDLES = 200;
const MAX_STALE_MS = 150000;
const SIGNAL_TTL_MS = 40000;
const THRESHOLD = 64;

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb', strict: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

let cache = { at: 0, candles: null, error: null };
let lastSignalCandle = null;
let activeSignal = null;
let keyCursor = 0;
let lastLoggedMarketError = '';
let lastLoggedMarketErrorAt = 0;
const keyHealth = new Map();
const keyNextAllowedAt = new Map();
function configuredKeys() {
  const many = (process.env.TWELVE_DATA_KEYS || '').split(',').map(x => x.trim()).filter(Boolean);
  const keys = many.length ? many : [process.env.TWELVE_DATA_API_KEY || ''].filter(Boolean);
  return [...new Set(keys)];
}
function utcTomorrow() { const d = new Date(); d.setUTCHours(24,0,0,0); return d.getTime(); }
function stateFor(i) {
  if (!keyHealth.has(i)) keyHealth.set(i,{status:'READY',message:'',retryAt:0});
  const st=keyHealth.get(i);
  if (['RATE_LIMITED','ERROR','DEPLETED'].includes(st.status) && Date.now()>=st.retryAt) {
    st.status='READY'; st.message=''; st.retryAt=0;
  }
  return st;
}
function apiKeySummary() {
  const items=configuredKeys().map((_,i)=>({index:i+1,...stateFor(i)}));
  const count=x=>items.filter(k=>k.status===x).length;
  return {total:items.length,active:count('ACTIVE'),ready:count('READY'),depleted:count('DEPLETED'),
    rateLimited:count('RATE_LIMITED'),error:count('ERROR'),
    allDepleted:items.length>0&&items.every(k=>k.status==='DEPLETED'),
    allUnavailable:items.length>0&&items.every(k=>!['READY','ACTIVE'].includes(k.status)),
    keys:items.map(({index,status,message,retryAt})=>({index,status,message,retryAt}))};
}
function markKey(i,status,message='',retryAt=0) {
  keyHealth.set(i,{status,message:String(message).slice(0,120),retryAt});
  if(status==='ACTIVE') for(const [j,st] of keyHealth.entries()) if(j!==i&&st.status==='ACTIVE') st.status='READY';
}
function isQuotaDepleted(response,data) {
  const msg=String(data?.message||data?.msg||'').toLowerCase();
  return /daily|per day|credits exhausted|quota.*(exceed|exhaust|limit)|api credits|credit limit/.test(msg);
}

function connectionStatus() {
  return { status: 'ONLINE', apiKeys: apiKeySummary(), service: 'MAIN_MARKET_EURUSD_M1', market: 'MAIN', symbol: SYMBOL,
    timeframe: '1min', provider: 'Twelve Data' };
}
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let v = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i=period;i<values.length;i++) v = values[i]*k + v*(1-k);
  return v;
}
function rsi(values, period=14) {
  if (values.length <= period) return null;
  let gain=0, loss=0;
  for(let i=values.length-period;i<values.length;i++){
    const d=values[i]-values[i-1]; if(d>0)gain+=d; else loss-=d;
  }
  if(loss===0)return 100;
  return 100-(100/(1+gain/loss));
}
function macd(values) {
  const fast=ema(values,12), slow=ema(values,26);
  if(fast===null||slow===null)return null;
  const histValues=[];
  for(let i=26;i<=values.length;i++){
    const f=ema(values.slice(0,i),12), s=ema(values.slice(0,i),26);
    if(f!==null&&s!==null)histValues.push(f-s);
  }
  const signal=ema(histValues,9);
  return { line:fast-slow, signal, histogram:signal===null?null:(fast-slow)-signal };
}
function analyze(candles) {
  const c=candles.map(x=>x.close), last=candles.at(-1), prev=candles.at(-2);
  const e9=ema(c,9), e21=ema(c,21), e50=ema(c,50), rv=rsi(c), m=macd(c);
  if([e9,e21,e50,rv,m?.histogram].some(x=>x===null||!Number.isFinite(x)))
    return { signal:'STANDBY', regime:'UNCLEAR', score:0, reason:'Insufficient indicator history' };
  const ranges=candles.slice(-20).map(x=>x.high-x.low);
  const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length;
  const currentRange=last.high-last.low;
  const returns=candles.slice(-20).map(x=>Math.abs(x.close-x.open));
  const bodyAvg=returns.reduce((a,b)=>a+b,0)/returns.length;
  const upTrend=e9>e21&&e21>e50, downTrend=e9<e21&&e21<e50;
  const highVol=currentRange>Math.max(avgRange*2.2, bodyAvg*3);
  const recentHigh=Math.max(...candles.slice(-21,-1).map(x=>x.high));
  const recentLow=Math.min(...candles.slice(-21,-1).map(x=>x.low));
  const nearResistance=(recentHigh-last.close)<=avgRange*0.25;
  const nearSupport=(last.close-recentLow)<=avgRange*0.25;
  const bullish=last.close>last.open&&last.close>prev.close;
  const bearish=last.close<last.open&&last.close<prev.close;
  const momentumUp=rv>=52&&m.histogram>0, momentumDown=rv<=48&&m.histogram<0;
  let regime='UNCLEAR';
  if(highVol) regime='HIGH VOLATILITY';
  else if((upTrend&&rv>55)||(downTrend&&rv<45)) regime='TRENDING';
  else if(Math.abs(e9-e21)<avgRange*0.18&&rv>=42&&rv<=58) regime='RANGING';
  else if((upTrend&&rv<48)||(downTrend&&rv>52)) regime='REVERSAL';

  const up=[upTrend,e9>e21,momentumUp,rv>50,m.histogram>0,bullish,last.close>e9&&!nearResistance].filter(Boolean).length;
  const dn=[downTrend,e9<e21,momentumDown,rv<50,m.histogram<0,bearish,last.close<e9&&!nearSupport].filter(Boolean).length;
  // Calibrated evidence scale: 4 of 7 checks maps to 64 points;
  // 3 checks maps to 48 and remains below THRESHOLD. 7 checks caps at 100.
  const evidenceScore = count => Math.min(100, count * 16);
  const scoreUp=evidenceScore(up), scoreDown=evidenceScore(dn);
  let signal='STANDBY', score=Math.max(scoreUp,scoreDown), reason=[];
  if(highVol) reason.push('Volatility spike');
  if(regime==='UNCLEAR') reason.push('Market regime unclear');
  if(scoreUp>=THRESHOLD&&scoreUp>scoreDown&&regime!=='HIGH VOLATILITY'&&regime!=='RANGING'&&!(nearResistance&&upTrend)){
    signal='CALL';score=scoreUp;reason=['EMA alignment bullish','RSI/MACD momentum confirms','Price action supports CALL'];
  } else if(scoreDown>=THRESHOLD&&scoreDown>scoreUp&&regime!=='HIGH VOLATILITY'&&regime!=='RANGING'&&!(nearSupport&&downTrend)){
    signal='PUT';score=scoreDown;reason=['EMA alignment bearish','RSI/MACD momentum confirms','Price action supports PUT'];
  } else {
    reason.push('Evidence below strict threshold or conflicting');
  }
  return { signal, regime, score, reason:reason.join(' · '), indicators:{
    ema9:e9,ema21:e21,ema50:e50,rsi:rv,macdHistogram:m.histogram,
    support:recentLow,resistance:recentHigh,volatility:currentRange/Math.max(avgRange,1e-9),
    momentum:rv>=52?'BULLISH':rv<=48?'BEARISH':'NEUTRAL'
  }};
}
async function fetchCandles(force=false) {
  const now=Date.now();
  if(!force&&cache.candles&&now-cache.at<CACHE_MS)return cache;
  const keys=configuredKeys();
  if(!keys.length)throw new Error('TWELVE_DATA_API_KEYS_MISSING');
  let lastError='TWELVE_DATA_UNAVAILABLE';
  for(let offset=0;offset<keys.length;offset++) {
    const i=(keyCursor+offset)%keys.length, st=stateFor(i);
    if(['DEPLETED','RATE_LIMITED','ERROR'].includes(st.status))continue;
    if(Date.now()<(keyNextAllowedAt.get(i)||0))continue;
    keyNextAllowedAt.set(i,Date.now()+10000);
    const url=new URL(API_BASE);
    url.search=new URLSearchParams({symbol:SYMBOL,interval:INTERVAL,outputsize:String(MAX_CANDLES),timezone:'UTC',apikey:keys[i]}).toString();
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
      const data=await response.json().catch(()=>({}));
      if(response.status===429||data.code===429||isQuotaDepleted(response,data)) {
        const depleted=isQuotaDepleted(response,data);
        markKey(i,depleted?'DEPLETED':'RATE_LIMITED',data.message||'Rate limited',
          depleted?utcTomorrow():Date.now()+60000);
        lastError=depleted?'TWELVE_DATA_QUOTA_EXHAUSTED':'TWELVE_DATA_RATE_LIMIT';
        continue;
      }
      if(!response.ok||data.status==='error'||!Array.isArray(data.values)) {
        markKey(i,'ERROR',data.message||'Provider error',Date.now()+60000);
        lastError=data.message||'TWELVE_DATA_UNAVAILABLE'; continue;
      }
      const candles=data.values.map(v=>({time:Date.parse(v.datetime.replace(' ','T')+'Z'),
        open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)}))
        .filter(x=>Number.isFinite(x.time)&&[x.open,x.high,x.low,x.close].every(Number.isFinite))
        .filter(x=>x.time+60000<=Date.now()).sort((a,b)=>a.time-b.time);
      if(candles.length<60) {
        markKey(i,'ERROR','Insufficient historical candles',Date.now()+60000);
        lastError='INSUFFICIENT_CANDLES'; continue;
      }
      markKey(i,'ACTIVE',''); keyCursor=(i+1)%keys.length;
      cache={at:Date.now(),candles,error:null}; return cache;
    } catch(error) {
      markKey(i,'ERROR',error.message||'Network error',Date.now()+30000);
      lastError=error.message||'TWELVE_DATA_UNAVAILABLE';
    }
  }
  const summary=apiKeySummary();
  if(summary.allDepleted)throw new Error('ALL_API_KEYS_DEPLETED');
  if(summary.allUnavailable)throw new Error('ALL_API_KEYS_UNAVAILABLE');
  throw new Error(lastError);
}
function candleCountdownSeconds(now = Date.now()) {
  const elapsedMs = now % 60000;
  return Math.max(1, Math.ceil((60000 - elapsedMs) / 1000));
}
function publicState(candles) {
  const now=Date.now(), latest=candles.at(-1), age=now-latest.time-60000;
  const countdownSeconds=candleCountdownSeconds(now);
  const fresh=age<=MAX_STALE_MS && age>=-60000;
  if(!fresh)return { ...connectionStatus(),signal:'STANDBY',regime:'UNCLEAR',score:0,
    reason:'ข้อมูลแท่งเทียนล่าช้าหรือไม่สดใหม่',price:latest.close,dataAgeMs:Math.max(0,age),
    candleTime:new Date(latest.time).toISOString(),countdownSeconds,signalExpiresAt:null,
    signalWindowOpen:false };
  const analysis=analyze(candles);
  const candleId=latest.time;
  if(analysis.signal!=='STANDBY' && lastSignalCandle!==candleId){
    lastSignalCandle=candleId;
    // Keep the closed-candle decision available until the final 5 seconds
    // of the current M1 candle; do not expose it early.
    activeSignal={...analysis,candleTime:candleId,
      expiresAt:now+((countdownSeconds-1)*1000)+10000};
  }
  if(activeSignal&&now>=activeSignal.expiresAt)activeSignal=null;
  const signalWindowOpen=countdownSeconds<=5;
  const visible=signalWindowOpen&&activeSignal&&activeSignal.candleTime===candleId?activeSignal:null;

  return {...connectionStatus(),signal:visible?.signal||'STANDBY',
    regime:analysis.regime,score:visible?.score??analysis.score,reason:visible?.reason||analysis.reason,
    price:latest.close,dataAgeMs:Math.max(0,age),candleTime:new Date(latest.time).toISOString(),
    countdownSeconds,signalWindowOpen,
    signalExpiresAt:visible?.expiresAt||null,indicators:analysis.indicators||null};
}
app.get('/health',(_req,res)=>res.json(connectionStatus()));
app.get('/api/connection',(_req,res)=>res.json(connectionStatus()));
app.get('/api/market',async(_req,res)=>{
  try{const data=await fetchCandles();res.set('Cache-Control','no-store');res.json(publicState(data.candles));}
  catch(error){if(error.message!==lastLoggedMarketError||Date.now()-lastLoggedMarketErrorAt>30000){console.error('Market data unavailable:',error.message);lastLoggedMarketError=error.message;lastLoggedMarketErrorAt=Date.now();}
    res.status(503).json({...connectionStatus(),status:'DEGRADED',signal:'STANDBY',regime:'UNCLEAR',score:0,
      reason:error.message==='TWELVE_DATA_API_KEYS_MISSING'?'Twelve Data API keys are not configured':error.message==='ALL_API_KEYS_DEPLETED'?'All API Keys Depleted':error.message==='ALL_API_KEYS_UNAVAILABLE'?'All API Keys Unavailable':'Market data unavailable · '+error.message,
      price:null,dataAgeMs:null,countdownSeconds:candleCountdownSeconds(),signalWindowOpen:candleCountdownSeconds()<=5});}
});
app.use((error,_req,res,_next)=>{
  if(error?.type==='entity.too.large')return res.status(413).json({error:'REQUEST_TOO_LARGE'});
  if(error instanceof SyntaxError)return res.status(400).json({error:'INVALID_JSON'});
  console.error(error);res.status(500).json({error:'INTERNAL_SERVER_ERROR'});
});
if(require.main===module)app.listen(PORT,'0.0.0.0',()=>console.log('AI Signal Radar EUR/USD M1 listening on '+PORT));
module.exports={app,analyze,ema,rsi,macd,connectionStatus,apiKeySummary,configuredKeys};
