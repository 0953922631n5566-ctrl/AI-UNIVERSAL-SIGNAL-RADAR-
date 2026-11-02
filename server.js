'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const SYMBOL = 'EUR/USD';
const INTERVAL = '1min';
const REFRESH_MS = Math.max(60000, Number(process.env.DATA_REFRESH_MS || 125000));
const MAX_AGE_MS = Number(process.env.MAX_CANDLE_AGE_MS || 180000);
const HOLD_MS = 40000;
const MIN_SCORE = Number(process.env.MIN_SIGNAL_SCORE || 68);
const API_URL = 'https://api.twelvedata.com/time_series';

const state = {
  service: 'AI UNIVERSAL SIGNAL RADAR',
  mode: 'MAIN MARKET',
  symbol: SYMBOL,
  interval: INTERVAL,
  running: false,
  connected: false,
  lastFetchAt: null,
  lastCandleAt: null,
  dataAgeMs: null,
  price: null,
  candles: [],
  indicators: null,
  regime: 'UNCLEAR',
  signal: 'STANDBY',
  signalReason: 'รอเริ่มสแกน',
  evidence: [],
  score: 0,
  signalId: null,
  signalCreatedAt: null,
  signalExpiresAt: null,
  lastError: null,
  nextPollAt: null,
  apiCallsToday: 0,
  apiDay: new Date().toISOString().slice(0,10)
};
let timer = null;
let busy = false;
let lastSignalCandle = null;

function isoNow(){ return new Date().toISOString(); }
function round(n,d=6){ return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }
function mean(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function ema(values, period){
  if (!values.length) return [];
  const k=2/(period+1), out=[values[0]];
  for(let i=1;i<values.length;i++) out.push(values[i]*k+out[i-1]*(1-k));
  return out;
}
function rsi(values, period=14){
  if(values.length<2) return null;
  const changes=[];
  for(let i=1;i<values.length;i++) changes.push(values[i]-values[i-1]);
  let gains=0, losses=0;
  const seed=changes.slice(0,period);
  for(const x of seed){ if(x>0) gains+=x; else losses-=x; }
  let avgG=gains/Math.max(1,seed.length), avgL=losses/Math.max(1,seed.length);
  for(const x of changes.slice(period)){ avgG=(avgG*(period-1)+Math.max(0,x))/period; avgL=(avgL*(period-1)+Math.max(0,-x))/period; }
  if(avgL===0) return 100;
  return 100-(100/(1+avgG/avgL));
}
function macd(values){
  if(values.length<2) return null;
  const fast=ema(values,12), slow=ema(values,26);
  const line=values.map((_,i)=>fast[i]-slow[i]);
  const signal=ema(line,9);
  return {line:line.at(-1), signal:signal.at(-1), histogram:line.at(-1)-signal.at(-1)};
}
function atr(candles, period=14){
  if(candles.length<2) return null;
  const trs=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i], p=candles[i-1];
    trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  return mean(trs.slice(-period));
}
function adx(candles, period=14){
  if(candles.length<period+2) return null;
  const plus=[],minus=[],trs=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i],p=candles[i-1];
    const up=c.high-p.high, down=p.low-c.low;
    plus.push(up>down&&up>0?up:0); minus.push(down>up&&down>0?down:0);
    trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  let tr=mean(trs.slice(0,period))*period, pDM=mean(plus.slice(0,period))*period, mDM=mean(minus.slice(0,period))*period;
  const dx=[];
  for(let i=period;i<trs.length;i++){
    tr=tr-tr/period+trs[i]; pDM=pDM-pDM/period+plus[i]; mDM=mDM-mDM/period+minus[i];
    const pdi=tr?100*pDM/tr:0, mdi=tr?100*mDM/tr:0;
    dx.push((pdi+mdi)?100*Math.abs(pdi-mdi)/(pdi+mdi):0);
  }
  return dx.length?mean(dx.slice(-period)):null;
}
function parseCandle(v){
  const time=Date.parse(v.datetime.endsWith('Z')?v.datetime:v.datetime.replace(' ','T')+'Z');
  const c={time,datetime:new Date(time).toISOString(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)};
  if(!Number.isFinite(time)||![c.open,c.high,c.low,c.close].every(Number.isFinite)||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)) return null;
  return c;
}
function marketPerception(candles){
  const closes=candles.map(c=>c.close), e5=ema(closes,5),e20=ema(closes,20),e50=ema(closes,50);
  const m=macd(closes), r=rsi(closes), a=atr(candles), x=adx(candles);
  const last=candles.at(-1), prev=candles.at(-2);
  const body=Math.abs(last.close-last.open), range=Math.max(1e-12,last.high-last.low);
  return {ema5:e5.at(-1),ema20:e20.at(-1),ema50:e50.at(-1),rsi14:r,macd:m,atr14:a,adx14:x,
    bullish:last.close>last.open,bearish:last.close<last.open,bodyRatio:body/range,
    momentum3:closes.length>=4?last.close-closes.at(-4):null,
    momentum5:closes.length>=6?last.close-closes.at(-6):null,
    priorClose:prev?.close??null, close:last.close};
}
function classifyRegime(candles,ind){
  if(candles.length<20) return 'UNCLEAR';
  const recent=candles.slice(-10), ranges=recent.map(c=>c.high-c.low);
  const baseline=mean(candles.slice(-40,-10).map(c=>c.high-c.low))||mean(ranges);
  const volatility=mean(ranges)/(baseline||1e-12);
  if(volatility>2.2 || (ind.atr14 && ind.bodyRatio>0.88 && volatility>1.6)) return 'HIGH VOLATILITY';
  const aligned=(ind.ema5>ind.ema20&&ind.ema20>ind.ema50)||(ind.ema5<ind.ema20&&ind.ema20<ind.ema50);
  if(ind.adx14!==null&&ind.adx14>=22&&aligned) return 'TRENDING';
  const last=candles.at(-1), prev=candles.at(-2);
  const recentHigh=Math.max(...candles.slice(-12,-1).map(c=>c.high));
  const recentLow=Math.min(...candles.slice(-12,-1).map(c=>c.low));
  const reversalUp=last.close>last.open&&prev.close<prev.open&&last.close>prev.open;
  const reversalDown=last.close<last.open&&prev.close>prev.open&&last.close<prev.open;
  if((reversalUp&&last.close>recentHigh)||(reversalDown&&last.close<recentLow)) return 'REVERSAL';
  return 'RANGING';
}
function adaptiveAnalysis(candles,ind,regime){
  const last=candles.at(-1), prev=candles.at(-2);
  const up=ind.ema5>ind.ema20, down=ind.ema5<ind.ema20;
  const macdUp=ind.macd&&ind.macd.histogram>0, macdDown=ind.macd&&ind.macd.histogram<0;
  const callReasons=[],putReasons=[];
  if(up)callReasons.push('EMA5 อยู่เหนือ EMA20'); if(down)putReasons.push('EMA5 อยู่ใต้ EMA20');
  if(last.close>ind.ema5&&last.close>ind.ema20)callReasons.push('ราคาปิดยืนเหนือ EMA5/20');
  if(last.close<ind.ema5&&last.close<ind.ema20)putReasons.push('ราคาปิดอยู่ใต้ EMA5/20');
  if(macdUp)callReasons.push('MACD Histogram เป็นบวก'); if(macdDown)putReasons.push('MACD Histogram เป็นลบ');
  if(ind.rsi14!==null&&ind.rsi14>=50&&ind.rsi14<=75)callReasons.push('RSI สนับสนุนแรงซื้อ');
  if(ind.rsi14!==null&&ind.rsi14>=25&&ind.rsi14<=50)putReasons.push('RSI สนับสนุนแรงขาย');
  if(last.close>prev.close)callReasons.push('แท่งล่าสุดปิดสูงกว่าแท่งก่อน');
  if(last.close<prev.close)putReasons.push('แท่งล่าสุดปิดต่ำกว่าแท่งก่อน');
  const score=(reasons)=>Math.min(100,reasons.length*19+(regime==='TRENDING'?18:0));
  return {callScore:score(callReasons),putScore:score(putReasons),callReasons,putReasons,regime};
}
function decisionEngine(candles,ind,regime,analysis,age){
  if(age>MAX_AGE_MS) return {signal:'STANDBY',score:0,reason:'ข้อมูลราคาเก่าเกินกำหนด',evidence:['ตรวจสอบความสดของข้อมูลไม่ผ่าน']};
  if(candles.length<5) return {signal:'STANDBY',score:0,reason:'ข้อมูลแท่งเทียนยังไม่ครบอย่างน้อย 5 แท่ง',evidence:[]};
  if(regime!=='TRENDING') return {signal:'STANDBY',score:0,reason:'สภาพตลาดไม่เหมาะกับการตามแนวโน้ม: '+regime,evidence:['ระบบป้องกันสัญญาณในตลาดผันผวน/Sideways']};
  if(candles.length<51||ind.rsi14===null||!ind.macd||ind.adx14===null) return {signal:'STANDBY',score:0,reason:'กำลังสะสมข้อมูลสำหรับ EMA50 / RSI / MACD / ADX',evidence:['ต้องใช้ประวัติแท่งเทียนเพิ่มก่อนตัดสินใจ']};
  const long=(ind.ema5>ind.ema20&&ind.ema20>ind.ema50);
  const short=(ind.ema5<ind.ema20&&ind.ema20<ind.ema50);
  const up=long&&analysis.callScore>=MIN_SCORE&&ind.macd.histogram>0&&ind.rsi14>=50&&ind.rsi14<=75;
  const down=short&&analysis.putScore>=MIN_SCORE&&ind.macd.histogram<0&&ind.rsi14>=25&&ind.rsi14<=50;
  if(up) return {signal:'CALL',score:analysis.callScore,reason:'แนวโน้มขาขึ้นและโมเมนตัมยืนยัน',evidence:analysis.callReasons};
  if(down) return {signal:'PUT',score:analysis.putScore,reason:'แนวโน้มขาลงและโมเมนตัมยืนยัน',evidence:analysis.putReasons};
  return {signal:'STANDBY',score:Math.max(analysis.callScore,analysis.putScore),reason:'หลักฐานยังไม่สอดคล้องครบตามเกณฑ์',evidence:[...analysis.callReasons,...analysis.putReasons].slice(0,6)};
}
async function fetchMarket(){
  if(!API_KEY) throw new Error('ยังไม่ได้ตั้งค่า TWELVE_DATA_API_KEY บน Render');
  const url=new URL(API_URL); url.searchParams.set('symbol',SYMBOL);url.searchParams.set('interval',INTERVAL);url.searchParams.set('outputsize','120');url.searchParams.set('timezone','UTC');url.searchParams.set('apikey',API_KEY);
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  const json=await response.json();
  state.apiCallsToday++; if(!response.ok||json.status==='error'||json.code) throw new Error(json.message||'Twelve Data HTTP '+response.status);
  if(!Array.isArray(json.values)) throw new Error('Twelve Data ไม่ส่งข้อมูลแท่งเทียนกลับมา');
  const now=Date.now();
  const parsed=json.values.map(parseCandle).filter(Boolean).sort((a,b)=>a.time-b.time);
  const closed=parsed.filter(c=>c.time+60000<=now-3000);
  if(closed.length<5) throw new Error('ข้อมูลแท่งปิดแล้วไม่เพียงพอ');
  const unique=closed.filter((c,i,a)=>i===0||c.time!==a[i-1].time);
  const latest=unique.at(-1),age=now-(latest.time+60000);
  state.candles=unique.slice(-120);state.lastFetchAt=isoNow();state.lastCandleAt=latest.datetime;state.dataAgeMs=age;state.price=latest.close;state.connected=true;state.lastError=null;
  const ind=marketPerception(state.candles),regime=classifyRegime(state.candles,ind),adaptive=adaptiveAnalysis(state.candles,ind,regime);
  const decision=decisionEngine(state.candles,ind,regime,adaptive,age);
  state.indicators={ema5:round(ind.ema5),ema20:round(ind.ema20),ema50:round(ind.ema50),rsi14:round(ind.rsi14,2),macd:ind.macd?{line:round(ind.macd.line),signal:round(ind.macd.signal),histogram:round(ind.macd.histogram)}:null,atr14:round(ind.atr14),adx14:round(ind.adx14,2)};
  state.regime=regime;
  const candleId=latest.time;
  if(decision.signal!=='STANDBY'&&candleId!==lastSignalCandle){
    lastSignalCandle=candleId;state.signal=decision.signal;state.score=decision.score;state.signalReason=decision.reason;state.evidence=decision.evidence;
    state.signalId=String(candleId)+'-'+decision.signal;state.signalCreatedAt=Date.now();state.signalExpiresAt=Date.now()+HOLD_MS;
  } else if(state.signalExpiresAt&&Date.now()>=state.signalExpiresAt){
    state.signal='STANDBY';state.score=decision.score;state.signalReason='สัญญาณหมดอายุแล้ว — รอการยืนยันรอบใหม่';state.evidence=decision.evidence;state.signalExpiresAt=null;state.signalId=null;
  } else if(decision.signal==='STANDBY'&&(!state.signalExpiresAt||Date.now()>=state.signalExpiresAt)){
    state.signal='STANDBY';state.score=decision.score;state.signalReason=decision.reason;state.evidence=decision.evidence;state.signalExpiresAt=null;state.signalId=null;
  }
}
async function monitor(){
  if(busy||!state.running)return;busy=true;state.nextPollAt=Date.now()+REFRESH_MS;
  try{await fetchMarket();}catch(e){state.connected=false;state.lastError=e.message;state.signal='STANDBY';state.signalReason='หยุดออกสัญญาณ: '+e.message;state.evidence=['Fail-safe: ไม่ใช้ข้อมูลเก่าหรือข้อมูลจำลอง'];state.signalExpiresAt=null;state.signalId=null;}
  finally{busy=false;state.nextPollAt=Date.now()+REFRESH_MS;}
}
function start(){if(state.running)return;state.running=true;state.signal='STANDBY';state.signalReason='เริ่มเฝ้าตลาด รอข้อมูลจริง';monitor();timer=setInterval(monitor,REFRESH_MS);}
function stop(){state.running=false;if(timer)clearInterval(timer);timer=null;state.signal='STANDBY';state.signalReason='หยุดสแกนตามคำสั่ง';state.signalExpiresAt=null;state.signalId=null;}
function snapshot(){
  if(state.signalExpiresAt&&Date.now()>=state.signalExpiresAt){state.signal='STANDBY';state.signalReason='สัญญาณหมดอายุแล้ว';state.signalExpiresAt=null;state.signalId=null;}
  return {...state,serverTime:Date.now(),refreshMs:REFRESH_MS,holdMs:HOLD_MS,maxCandleAgeMs:MAX_AGE_MS};
}
function send(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj));}
const publicDir=path.join(__dirname,'public');
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'});return res.end();}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/health')return send(res,200,{ok:true,service:state.service,mode:state.mode,symbol:SYMBOL,running:state.running,connected:state.connected,hasApiKey:Boolean(API_KEY),serverTime:Date.now()});
  if(url.pathname==='/api/state')return send(res,200,snapshot());
  if(url.pathname==='/api/candles')return send(res,200,{symbol:SYMBOL,interval:INTERVAL,candles:state.candles,indicators:state.indicators});
  if(url.pathname==='/api/start'&&req.method==='POST'){start();return send(res,200,{ok:true,state:snapshot()});}
  if(url.pathname==='/api/stop'&&req.method==='POST'){stop();return send(res,200,{ok:true,state:snapshot()});}
  const file=url.pathname==='/'?path.join(publicDir,'index.html'):path.join(publicDir,path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if(!file.startsWith(publicDir)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream','cache-control':'no-cache'});res.end(data);});
});
server.listen(PORT,'0.0.0.0',()=>console.log('AI UNIVERSAL SIGNAL RADAR listening on '+PORT));
process.on('SIGTERM',()=>{stop();server.close(()=>process.exit(0));});
