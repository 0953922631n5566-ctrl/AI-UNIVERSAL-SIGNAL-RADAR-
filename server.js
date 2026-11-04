'use strict';
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');

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
let lastTelegramSignalCandle = null;
let activeSignal = null;
let apiNextAllowedAt = 0;

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
function connectionStatus() {
  return { status: 'ONLINE', service: 'MAIN_MARKET_EURUSD_M1', market: 'MAIN', symbol: SYMBOL,
    timeframe: '1min', provider: 'Twelve Data', telegramConfigured: telegramConfigured(),
    notificationAuthConfigured: Boolean(process.env.TELEGRAM_NOTIFY_TOKEN) };
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
  const scoreUp=Math.round(up/7*100), scoreDown=Math.round(dn/7*100);
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
  if(now<apiNextAllowedAt) {
    if(cache.candles)return cache;
    throw new Error('RATE_LIMIT_GUARD');
  }
  const key=process.env.TWELVE_DATA_API_KEY;
  if(!key)throw new Error('TWELVE_DATA_API_KEY_MISSING');
  apiNextAllowedAt=now+10000;
  const url=new URL(API_BASE);
  url.search=new URLSearchParams({symbol:SYMBOL,interval:INTERVAL,outputsize:String(MAX_CANDLES),timezone:'UTC',apikey:key}).toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  if(response.status===429||data.code===429)throw new Error('TWELVE_DATA_RATE_LIMIT');
  if(!response.ok||data.status==='error'||!Array.isArray(data.values))throw new Error(data.message||'TWELVE_DATA_UNAVAILABLE');
  const candles=data.values.map(v=>({time:Date.parse(v.datetime.replace(' ','T')+'Z'),
    open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)}))
    .filter(x=>Number.isFinite(x.time)&&[x.open,x.high,x.low,x.close].every(Number.isFinite))
    .filter(x=>x.time+60000<=Date.now())
    .sort((a,b)=>a.time-b.time);
  if(candles.length<60)throw new Error('INSUFFICIENT_CANDLES');
  cache={at:now,candles,error:null};
  return cache;
}
async function sendTelegramMessage(message) {
  if (!telegramConfigured()) return;
  try {
    const response = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) console.error('Telegram delivery failed:', result.description || response.status);
  } catch (error) { console.error('Telegram connection failed:', error.message); }
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
    // Keep the closed-candle decision available until the final 10 seconds
    // of the current M1 candle; do not expose it early.
    activeSignal={...analysis,candleTime:candleId,
      expiresAt:now+((countdownSeconds-1)*1000)+10000};
  }
  if(activeSignal&&now>=activeSignal.expiresAt)activeSignal=null;
  const signalWindowOpen=countdownSeconds<=10;
  const visible=signalWindowOpen&&activeSignal&&activeSignal.candleTime===candleId?activeSignal:null;
  // Telegram is sent once, only after the final-10-second window opens.
  if(visible && lastTelegramSignalCandle!==candleId){
    lastTelegramSignalCandle=candleId;
    const label = visible.signal === 'CALL' ? '🟢 CALL' : '🔴 PUT';
    void sendTelegramMessage('AI UNIVERSAL SIGNAL RADAR\\nMAIN MARKET · EUR/USD · M1\\n' + label +
      '\\nEvidence: ' + visible.score + '%\\nRegime: ' + visible.regime +
      '\\nPrice: ' + latest.close + '\\n' + visible.reason +
      '\\nEntry timing: final 10 seconds of candle · decision support only');
  }
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
  catch(error){console.error('Market data unavailable:',error.message);
    res.status(503).json({...connectionStatus(),signal:'STANDBY',regime:'UNCLEAR',score:0,
      reason:error.message==='TWELVE_DATA_API_KEY_MISSING'?'Twelve Data API key is not configured':'Market data unavailable · '+error.message,
      price:null,dataAgeMs:null,countdownSeconds:candleCountdownSeconds(),signalWindowOpen:candleCountdownSeconds()<=10});}
});
app.post('/api/telegram/notify',async(req,res)=>{
  const expected=process.env.TELEGRAM_NOTIFY_TOKEN||'', auth=req.get('authorization')||'';
  const supplied=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!expected||!supplied||supplied.length!==expected.length||
    !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))
    return res.status(401).json({ok:false,error:'UNAUTHORIZED'});
  if(!telegramConfigured())return res.status(503).json({ok:false,error:'TELEGRAM_NOT_CONFIGURED'});
  const message=typeof req.body?.message==='string'?req.body.message.trim():'';
  if(!message||message.length>4000)return res.status(400).json({ok:false,error:'MESSAGE_REQUIRED_OR_TOO_LONG'});
  try{
    const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:message,disable_web_page_preview:true}),
      signal:AbortSignal.timeout(10000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.ok!==true)return res.status(502).json({ok:false,error:'TELEGRAM_DELIVERY_FAILED'});
    res.json({ok:true,messageId:result.result?.message_id??null});
  }catch(error){res.status(502).json({ok:false,error:'TELEGRAM_CONNECTION_FAILED'});}
});
app.use((error,_req,res,_next)=>{
  if(error?.type==='entity.too.large')return res.status(413).json({error:'REQUEST_TOO_LARGE'});
  if(error instanceof SyntaxError)return res.status(400).json({error:'INVALID_JSON'});
  console.error(error);res.status(500).json({error:'INTERNAL_SERVER_ERROR'});
});
if(require.main===module)app.listen(PORT,'0.0.0.0',()=>console.log('AI Signal Radar EUR/USD M1 listening on '+PORT));
module.exports={app,analyze,ema,rsi,macd,connectionStatus};
