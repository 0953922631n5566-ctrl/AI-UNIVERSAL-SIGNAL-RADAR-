import "dotenv/config";
import express from "express";import http from "node:http";import path from "node:path";import{fileURLToPath}from"node:url";import WebSocket,{WebSocketServer}from"ws";
import{fetchCandles}from"./src/twelve-data.js";import{analyzeMarket}from"./src/analyzer.js";import{MIN_CANDLES,HISTORY_CANDLES,MAX_CANDLES,REST_SYNC_SECONDS,SYMBOLS,DEFAULT_SYMBOLS,normalizeSymbol}from"./src/config.js";
const APP_DIR=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,path:"/live"});
const PORT=Number(process.env.PORT||3000),INTERVAL=process.env.INTERVAL||"1min";
const SYNC=Math.max(REST_SYNC_SECONDS,Number(process.env.REST_SYNC_SECONDS||REST_SYNC_SECONDS)),MAXAGE=Number(process.env.MAX_DATA_AGE_SECONDS||180);
const feeds=new Map(SYMBOLS.map(symbol=>[symbol,{symbol,candles:[],tickAt:0,lastTick:null,lastRestSyncAt:0,restSyncPromise:null,subscribeAt:0,restStatus:"NOT_CHECKED",restMessage:"ยังไม่ได้ตรวจสอบข้อมูล",streamStatus:"WAITING",streamMessage:"รอเริ่มเชื่อมต่อ",analysis:null,activeSignal:null,activeUntil:0,signalCandle:null,lastAlertId:null,dataLocked:false}]));
let selectedSymbols=[...DEFAULT_SYMBOLS],upstream=null,restTimer=null,retryTimer=null,heartbeat=null,watchdog=null,monitoring=false,globalLockMessage=null,httpLeaseUntil=0;
const standby=(reason,extra={})=>({signal:"STANDBY",regime:"UNKNOWN",reason,evidence:[],metrics:null,analyzedAt:new Date().toISOString(),...extra});
function feedStatus(f){
 if(f.restStatus==="UNSUPPORTED")return"UNSUPPORTED";
 if(globalLockMessage||f.dataLocked)return"LOCKED";
 if(f.restStatus==="ERROR")return"DATA_ERROR";
 if(f.restStatus!=="READY")return"CHECKING";
 const age=f.tickAt?(Date.now()-f.tickAt)/1000:Infinity;
 if(age<=25)return"SUPPORTED";
 if(f.streamStatus==="UNSUPPORTED"||f.streamStatus==="ERROR"||f.streamStatus==="TIMEOUT")return"REST_ONLY";
 if(f.tickAt)return"STALE";
 return"WAITING_PRICE";
}
function publicFeed(f){
 const status=feedStatus(f),age=f.tickAt?(Date.now()-f.tickAt)/1000:null;
 const x=f.analysis||standby(f.restMessage||"รอข้อมูล");
 return{...x,symbol:f.symbol,selected:selectedSymbols.includes(f.symbol),supportStatus:status,restStatus:f.restStatus,streamStatus:f.streamStatus,statusMessage:status==="UNSUPPORTED"?(f.restMessage||f.streamMessage):status==="LOCKED"?(globalLockMessage||f.restMessage):status==="DATA_ERROR"?f.restMessage:status==="STREAM_ERROR"?f.streamMessage:status==="STREAM_TIMEOUT"?f.streamMessage:status==="STALE"?"ราคา Streaming ไม่อัปเดตเกิน 25 วินาที":status==="WAITING_PRICE"?"ข้อมูลย้อนหลังพร้อมแล้ว — รอราคา Streaming สด":status==="CHECKING"?"กำลังตรวจสอบคู่เงินกับ Twelve Data":status==="SUPPORTED"?"รองรับข้อมูลย้อนหลังและ Streaming สด":status==="REST_ONLY"?"REST รองรับ: มีแท่งปิดและคำนวณราคา/RSI/Close ได้ แต่ยังไม่มี Streaming สด":f.streamMessage,apiStatus:(status==="SUPPORTED"||status==="REST_ONLY")?"ONLINE":status==="LOCKED"?"LOCKED":monitoring?"CONNECTING":"OFFLINE",tickAgeSeconds:age===null?null:Math.round(age),lastTickPrice:f.lastTick,candleCount:f.candles.length,closedCandleCount:f.candles.filter(c=>!c.live&&c.epoch<Math.floor(Date.now()/60000)*60).length,requiredCandles:MIN_CANDLES,nextCandleAt:f.candles.length?(f.candles.at(-1).epoch+60)*1000:null,signalExpiresAt:f.activeSignal?new Date(f.activeUntil).toISOString():null,alertId:f.lastAlertId,source:"Twelve Data REST history + shared live-price WebSocket"};
}
function snapshot(){
 const pairs={};for(const symbol of selectedSymbols)pairs[symbol]=publicFeed(feeds.get(symbol));
 const values=Object.values(pairs),online=values.filter(x=>x.apiStatus==="ONLINE").length,locked=values.filter(x=>x.apiStatus==="LOCKED"||x.supportStatus==="UNSUPPORTED").length;
 const apiStatus=!monitoring?"OFFLINE":online?"ONLINE":locked===values.length?"LOCKED":"CONNECTING";
 const primary=values[0]||publicFeed(feeds.get(SYMBOLS[0]));
 return{...primary,symbols:SYMBOLS,selectedSymbols:[...selectedSymbols],pairs,monitoring,connected:online>0,serverOnline:true,apiStatus,apiMessage:globalLockMessage||`${online}/${values.length} คู่กำลังรับราคา Streaming สด`,onlineCount:online,unsupportedCount:values.filter(x=>x.supportStatus==="UNSUPPORTED").length,analyzedAt:new Date().toISOString()};
}
function publish(){
 const data=snapshot(),msg=JSON.stringify({type:"market_state",data});
 for(const c of wss.clients)if(c.readyState===WebSocket.OPEN)c.send(msg);
}
function isGlobalApiError(message){return/\b(401|429)\b|quota|credit limit|rate.?limit|unauthori[sz]ed|invalid api.?key|apikey is invalid/i.test(String(message||""))}
function isUnsupportedError(message){return/\b403\b|forbidden|unsupported|not supported|invalid symbol|symbol (?:is )?not found|not found|not available|permission|plan|subscription|access denied|does not have access|trial symbols?|maximum number of symbols|subscription limit|not entitled/i.test(String(message||""))}
function markLocked(message){
 globalLockMessage=String(message||"Twelve Data API ไม่พร้อม");
 for(const symbol of selectedSymbols){const f=feeds.get(symbol);f.dataLocked=true;f.activeSignal=null;f.activeUntil=0;f.analysis=standby(globalLockMessage)}
 console.error("[market-feed] ALL PAIRS LOCKED:",globalLockMessage);publish();
}
const floorMinute=t=>Math.floor(t/60)*60;
function analyze(f){
 if(f.restStatus!=="READY"){f.analysis=standby(f.restMessage||"ยังไม่มีประวัติข้อมูลที่ยืนยันได้",{closedCandleCount:0,requiredCandles:MIN_CANDLES});return}
 const tickAge=f.tickAt?(Date.now()-f.tickAt)/1000:null;
 const x=analyzeMarket(f.candles,{maxAgeSeconds:MAXAGE,tickAgeSeconds:tickAge});
 const cid=f.candles.at(-1)?.epoch;
 if(!x.metrics){f.activeSignal=null;f.activeUntil=0}
 if(x.metrics&&(x.signal==="CALL"||x.signal==="PUT")){
  if(f.activeSignal&&Date.now()<f.activeUntil&&f.activeSignal!==x.signal){x.signal=f.activeSignal;x.reason="คงทิศทางเดิมระหว่างช่วงป้องกันการสลับสัญญาณ"}
  else if((!f.activeSignal||Date.now()>=f.activeUntil)&&f.signalCandle!==cid){f.activeSignal=x.signal;f.activeUntil=Date.now()+40000;f.signalCandle=cid;f.lastAlertId=cid+":"+x.signal}
  else if(f.signalCandle===cid&&f.activeSignal!==x.signal){x.signal="STANDBY";x.reason="ป้องกันการสลับทิศทางภายในแท่งเทียนเดียวกัน"}
 }else if(x.metrics&&f.activeSignal&&Date.now()<f.activeUntil){
  const invalid=f.activeSignal==="CALL"?(x.regime==="TRENDING_DOWN"||f.candles.at(-1).close<x.metrics?.ema21):(x.regime==="TRENDING_UP"||f.candles.at(-1).close>x.metrics?.ema21);
  if(invalid){f.activeSignal=null;f.activeUntil=0;x.signal="STANDBY";x.reason="ยกเลิกสัญญาณเดิม: เงื่อนไขตลาดเปลี่ยน"}
  else{x.signal=f.activeSignal;x.reason="ติดตามสัญญาณเดิมในช่วงถือสัญญาณ 40 วินาที"}
 }else if(Date.now()>=f.activeUntil)f.activeSignal=null;
 f.analysis={...x,tickAgeSeconds:tickAge===null?null:Math.round(tickAge),lastTickPrice:f.lastTick,alertId:f.lastAlertId};
}
function applyTick(f,price,epoch){
 const start=floorMinute(epoch),time=new Date(start*1000).toISOString().slice(0,16).replace("T"," ");let cur=f.candles.at(-1);
 if(!cur||cur.epoch<start){if(cur)cur.live=false;cur={time,epoch:start,open:price,high:price,low:price,close:price,live:true};f.candles.push(cur);f.candles=f.candles.slice(-MAX_CANDLES)}
 else if(cur.epoch===start){cur.high=Math.max(cur.high,price);cur.low=Math.min(cur.low,price);cur.close=price;cur.live=true}else return;
 f.tickAt=Date.now();f.lastTick=price;f.streamStatus="READY";f.streamMessage="ได้รับราคา Streaming สด";f.dataLocked=false;
 if(globalLockMessage)globalLockMessage=null;
 analyze(f);publish();
}
async function syncPair(f,{force=false}={}){
 if(f.restSyncPromise)return f.restSyncPromise;
 if(!force&&f.restStatus==="READY"&&f.lastRestSyncAt&&Date.now()-f.lastRestSyncAt<SYNC*1000)return;
 f.lastRestSyncAt=Date.now();
 f.restSyncPromise=(async()=>{
  try{
   const d=await fetchCandles({apiKey:process.env.TWELVE_DATA_API_KEY,symbol:f.symbol,interval:INTERVAL,outputsize:HISTORY_CANDLES});
   const live=f.candles.at(-1),keepLive=!!(live?.live&&live.epoch===floorMinute(Date.now()/1000)&&f.tickAt&&Date.now()-f.tickAt<25000);
   f.candles=keepLive?[...d.candles.filter(c=>c.epoch<live.epoch),live].slice(-MAX_CANDLES):d.candles.slice(-MAX_CANDLES);
   f.restStatus="READY";f.restMessage=`รองรับ REST: โหลดแท่งปิดแล้ว ${d.candles.length}/${MIN_CANDLES}+`;f.dataLocked=false;
   if(globalLockMessage)globalLockMessage=null;
   console.info("[market-feed] REST history loaded",{symbol:f.symbol,requested:HISTORY_CANDLES,receivedClosed:d.candles.length,available:f.candles.length,requiredClosed:MIN_CANDLES,liveTickPresent:!!f.tickAt});
   analyze(f);
  }catch(e){
   const msg=e.message||"Twelve Data REST error";f.restMessage=msg;
   if(isGlobalApiError(msg)){markLocked("Twelve Data API: "+msg)}
   else if(isUnsupportedError(msg)){f.restStatus="UNSUPPORTED";f.streamStatus="UNSUPPORTED";f.dataLocked=true;f.analysis=standby("ไม่รองรับคู่เงินนี้หรือบัญชีไม่มีสิทธิ์เข้าถึง: "+msg);console.warn("[market-feed] PAIR UNSUPPORTED",f.symbol,msg)}
   else{f.restStatus="ERROR";f.analysis=standby("โหลดข้อมูลย้อนหลังไม่สำเร็จ: "+msg);console.error("[market-feed] REST error",f.symbol,msg)}
  }finally{publish()}
 })();
 try{return await f.restSyncPromise}finally{f.restSyncPromise=null}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function syncSelected({force=false}={}){
 for(let i=0;i<selectedSymbols.length;i++){
  const f=feeds.get(selectedSymbols[i]);if(f.streamStatus==="UNSUPPORTED"&&Date.now()-f.lastRestSyncAt>=SYNC*1000)f.streamStatus="WAITING";if(f.restStatus==="UNSUPPORTED"){if(Date.now()-f.lastRestSyncAt<SYNC*1000)continue;f.restStatus="NOT_CHECKED";f.streamStatus="WAITING";f.restMessage="กำลังตรวจสอบสิทธิ์คู่เงินอีกครั้ง"}
  await syncPair(f,{force});
  if(globalLockMessage)break;
  if(i<selectedSymbols.length-1)await delay(1100);
 }
 if(monitoring&&!upstream&&selectedSymbols.some(s=>feeds.get(s).restStatus==="READY"))startStream();
}
function startRest(){if(restTimer)return;restTimer=setInterval(()=>syncSelected().catch(e=>console.error("[market-feed] REST cycle failed",e.message)),SYNC*1000)}
function stopTimers(){clearInterval(restTimer);restTimer=null;clearInterval(heartbeat);heartbeat=null;clearInterval(watchdog);watchdog=null;clearTimeout(retryTimer);retryTimer=null}
function startStream(){
 if(upstream||!monitoring)return;
 if(!process.env.TWELVE_DATA_API_KEY){markLocked("ยังไม่ได้ตั้ง Twelve Data API Key ฝั่งเซิร์ฟเวอร์");return}
 const subscribeSymbols=selectedSymbols.filter(s=>feeds.get(s).restStatus==="READY"&&feeds.get(s).streamStatus!=="UNSUPPORTED");
 if(!subscribeSymbols.length){publish();return}
 console.info("[market-feed] START requested",{symbols:subscribeSymbols,interval:INTERVAL});
 startRest();clearInterval(watchdog);watchdog=setInterval(()=>{
  if(!monitoring)return;
  for(const symbol of selectedSymbols){const f=feeds.get(symbol);if(f.restStatus==="UNSUPPORTED"||f.streamStatus==="UNSUPPORTED")continue;
   if(f.tickAt&&Date.now()-f.tickAt>25000){f.dataLocked=true;f.activeSignal=null;f.activeUntil=0;f.analysis=standby("ราคา Streaming ของ "+symbol+" หยุดอัปเดตเกิน 25 วินาที");}
   else if(!f.tickAt&&(f.streamStatus==="SUBSCRIBING"||f.streamStatus==="READY")&&f.subscribeAt&&Date.now()-f.subscribeAt>25000){f.streamStatus="TIMEOUT";f.streamMessage="ไม่พบราคา Streaming ภายใน 25 วินาที — ยังยืนยันไม่ได้ว่าคู่นี้รองรับหรือไม่";f.analysis=standby(f.streamMessage)}
  }publish();
 },5000);
 let ws;
 try{ws=new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey="+encodeURIComponent(process.env.TWELVE_DATA_API_KEY));upstream=ws}
 catch(e){markLocked("สร้างการเชื่อมต่อ Twelve Data Streaming ไม่สำเร็จ: "+e.message);retryTimer=setTimeout(startStream,8000);return}
 ws.on("open",()=>{if(upstream!==ws)return;console.info("[market-feed] WebSocket OPEN; subscribing",subscribeSymbols);for(const symbol of subscribeSymbols){const f=feeds.get(symbol);if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="SUBSCRIBING";f.subscribeAt=Date.now();f.streamMessage="ส่งคำขอสมัครรับราคาแล้ว"}}ws.send(JSON.stringify({action:"subscribe",params:{symbols:subscribeSymbols.join(",")}}));heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"heartbeat"}))},10000);publish()});
 ws.on("message",raw=>{
  if(upstream!==ws)return;let m;try{m=JSON.parse(raw.toString())}catch{return}
  if(m.event==="price"&&m.symbol){const f=feeds.get(SYMBOLS.find(s=>normalizeSymbol(s)===normalizeSymbol(m.symbol)));const p=Number(m.price),t=Number(m.timestamp);if(f&&selectedSymbols.includes(f.symbol)&&Number.isFinite(p)&&Number.isFinite(t)){if(!f.tickAt)console.info("[market-feed] First live price received",f.symbol);applyTick(f,p,t)}return}
  if(m.event==="subscribe-status"){
   const message=String(m.message||m.code||"ผลการสมัครรับข้อมูล");
   const good=Array.isArray(m.success)?m.success:[],bad=Array.isArray(m.fails)?m.fails:Array.isArray(m.failed)?m.failed:[];
   const getSymbol=x=>typeof x==="string"?x:x?.symbol||x?.name||x?.ticker;
   for(const item of good){const rawSymbol=getSymbol(item),f=feeds.get(SYMBOLS.find(s=>normalizeSymbol(s)===normalizeSymbol(rawSymbol)));if(f){f.streamStatus="READY";f.streamMessage="Twelve Data ตอบรับการสมัครรับราคา"}}
   for(const item of bad){const rawSymbol=getSymbol(item),f=feeds.get(SYMBOLS.find(s=>normalizeSymbol(s)===normalizeSymbol(rawSymbol)));if(f){f.streamStatus="UNSUPPORTED";f.streamMessage="Twelve Data ไม่อนุญาต Streaming: "+message;f.analysis=standby("ไม่รองรับ Streaming สำหรับ "+f.symbol+": "+message);console.warn("[market-feed] STREAM UNSUPPORTED",f.symbol,message)}}
   const status=String(m.status||"").toLowerCase();
   if(status==="success"&&!good.length&&!bad.length){for(const symbol of selectedSymbols){const f=feeds.get(symbol);if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="READY";f.streamMessage="Twelve Data ตอบรับคำขอ Streaming"}}}
   if((status==="error"||status==="failed")&&!bad.length){const rawSymbol=m.symbol||m.params?.symbol,mentioned=selectedSymbols.filter(s=>message.toUpperCase().includes(s)),targets=rawSymbol?[feeds.get(SYMBOLS.find(s=>normalizeSymbol(s)===normalizeSymbol(rawSymbol)))].filter(Boolean):mentioned.length?mentioned.map(s=>feeds.get(s)):selectedSymbols.map(s=>feeds.get(s));for(const f of targets){f.streamStatus="UNSUPPORTED";f.streamMessage=message;f.analysis=standby("Twelve Data ไม่รองรับ Streaming: "+message)}}
   publish();return;
  }
  if(m.status==="error"||m.event==="error"){const msg=m.message||m.code||"Twelve Data Streaming error";if(isGlobalApiError(msg))markLocked("Twelve Data Streaming: "+msg);else if(isUnsupportedError(msg)){for(const symbol of selectedSymbols){const f=feeds.get(symbol);if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="UNSUPPORTED";f.streamMessage=msg;f.analysis=standby("ไม่รองรับ Streaming: "+msg)}}publish()}else{for(const symbol of selectedSymbols){const f=feeds.get(symbol);if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="ERROR";f.streamMessage=msg;f.analysis=standby("Streaming ผิดพลาด: "+msg)}}publish()}}
 });
 ws.on("error",e=>{if(upstream!==ws)return;console.error("[market-feed] WebSocket error:",e.message);for(const symbol of selectedSymbols){const f=feeds.get(symbol);if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="ERROR";f.streamMessage=e.message;f.analysis=standby("เชื่อมต่อ Streaming ไม่สำเร็จ: "+e.message)}}publish()});
 ws.on("close",()=>{if(upstream!==ws)return;console.warn("[market-feed] WebSocket CLOSED");upstream=null;clearInterval(heartbeat);heartbeat=null;for(const symbol of selectedSymbols){const f=feeds.get(symbol);f.tickAt=0;if(f.streamStatus!=="UNSUPPORTED"){f.streamStatus="ERROR";f.streamMessage="Streaming หลุด กำลังเชื่อมต่อใหม่";f.dataLocked=true;f.activeSignal=null;f.activeUntil=0;f.analysis=standby(f.streamMessage)}}publish();if(monitoring)retryTimer=setTimeout(startStream,8000)});
}
function stop(){
 monitoring=false;httpLeaseUntil=0;stopTimers();const old=upstream;upstream=null;if(old)old.close();
 for(const symbol of selectedSymbols){const f=feeds.get(symbol);f.tickAt=0;f.activeSignal=null;f.activeUntil=0;f.lastAlertId=null;f.signalCandle=null;f.dataLocked=false;if(f.streamStatus!=="UNSUPPORTED")f.streamStatus="WAITING";f.analysis=standby("หยุดเฝ้าระวังแล้ว")}
 globalLockMessage=null;publish();
}
const allowedWebOrigins=new Set(["https://ai-universal-signal-radar.onrender.com","https://ai-signal-radar-main-market.onrender.com"]);
app.use((req,res,next)=>{
 const origin=req.headers.origin;
 if(origin&&allowedWebOrigins.has(origin)){
  res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
 }
 if(req.method==="OPTIONS")return res.sendStatus(origin&&allowedWebOrigins.has(origin)?204:403);
 next();
});
app.use(express.json({limit:"2kb"}));
app.get("/",(_,res)=>{res.setHeader("Cache-Control","no-store, max-age=0, must-revalidate");res.sendFile(path.join(APP_DIR,"public","index.html"))});
app.get("/app.js",(_,res)=>{res.setHeader("Cache-Control","no-store, max-age=0, must-revalidate");res.sendFile(path.join(APP_DIR,"public","app.js"))});
app.get("/styles.css",(_,res)=>{res.setHeader("Cache-Control","no-store, max-age=0, must-revalidate");res.sendFile(path.join(APP_DIR,"public","styles.css"))});
app.use(express.static(path.join(APP_DIR,"public")));
app.get("/health",(_,r)=>{r.setHeader("Cache-Control","no-store");r.json({ok:true,service:"main-market",version:"2026-11-02-http-fallback",symbols:SYMBOLS,selectedSymbols,interval:INTERVAL,monitoring,streamConnected:!!upstream,apiKeyConfigured:!!process.env.TWELVE_DATA_API_KEY})});
app.get("/api/state",(_,r)=>{r.setHeader("Cache-Control","no-store");r.json(snapshot())});
function handleControlAction(m={}){
 if(m.action==="start"){
  const requested=Array.isArray(m.symbols)?m.symbols.map(normalizeSymbol):DEFAULT_SYMBOLS.map(normalizeSymbol);const chosen=SYMBOLS.find(s=>requested.includes(normalizeSymbol(s)))||DEFAULT_SYMBOLS[0];selectedSymbols=[chosen];monitoring=true;httpLeaseUntil=Date.now()+12000;globalLockMessage=null;startRest();
  for(const symbol of selectedSymbols){const f=feeds.get(symbol);f.tickAt=0;f.lastTick=null;f.subscribeAt=0;f.activeSignal=null;f.activeUntil=0;f.signalCandle=null;f.lastAlertId=null;f.dataLocked=false;if(f.restStatus==="NOT_CHECKED"||f.restStatus==="ERROR")f.restMessage="กำลังตรวจสอบ Twelve Data";if(f.streamStatus!=="UNSUPPORTED")f.streamStatus="WAITING";f.analysis=standby("กำลังเชื่อมต่อข้อมูล "+symbol)}publish();syncSelected({force:true}).catch(e=>console.error("[market-feed] initial REST cycle failed",e.message));return true;
 }
 if(m.action==="select"){
  const chosen=SYMBOLS.find(s=>normalizeSymbol(s)===normalizeSymbol(m.symbol));if(!chosen)return false;selectedSymbols=[chosen];if(monitoring)httpLeaseUntil=Date.now()+12000;const old=upstream;upstream=null;if(old)old.close();clearInterval(heartbeat);heartbeat=null;clearInterval(watchdog);watchdog=null;clearTimeout(retryTimer);retryTimer=null;
  for(const f of feeds.values()){f.activeSignal=null;f.activeUntil=0;f.lastAlertId=null;f.signalCandle=null;if(f.symbol!==chosen){f.tickAt=0;f.lastTick=null;f.analysis=standby("ไม่ได้เลือกสแกนคู่นี้")}}
  const f=feeds.get(chosen);f.tickAt=0;f.lastTick=null;f.subscribeAt=0;f.activeSignal=null;f.activeUntil=0;f.signalCandle=null;f.lastAlertId=null;f.dataLocked=false;if(f.restStatus==="NOT_CHECKED"||f.restStatus==="ERROR")f.restMessage="กำลังตรวจสอบ Twelve Data";if(f.streamStatus!=="UNSUPPORTED")f.streamStatus="WAITING";f.analysis=standby("กำลังเปลี่ยนไปสแกน "+chosen);publish();if(monitoring){startRest();syncSelected({force:true}).catch(e=>console.error("[market-feed] selected-pair switch failed",e.message))}return true;
 }
 if(m.action==="heartbeat"){if(monitoring)httpLeaseUntil=Date.now()+12000;return true}if(m.action==="stop"){stop();return true}return false;
}
app.post("/api/control",(req,res)=>{const action=req.body?.action;if(!["start","select","stop","heartbeat"].includes(action))return res.status(400).json({ok:false,error:"Unsupported action"});if(action==="select"&&!SYMBOLS.some(s=>normalizeSymbol(s)===normalizeSymbol(req.body?.symbol)))return res.status(400).json({ok:false,error:"Unsupported pair"});if(action==="start"&&Array.isArray(req.body?.symbols)&&!req.body.symbols.some(s=>SYMBOLS.some(x=>normalizeSymbol(x)===normalizeSymbol(s))))return res.status(400).json({ok:false,error:"Unsupported pair"});handleControlAction(req.body);res.setHeader("Cache-Control","no-store");res.json({ok:true,state:snapshot()})});
setInterval(()=>{if(monitoring&&![...wss.clients].some(c=>c.readyState===WebSocket.OPEN)&&httpLeaseUntil&&Date.now()>httpLeaseUntil){console.warn("[market-feed] HTTP client lease expired; stopping scan");stop()}},5000);
wss.on("connection",ws=>{ws.send(JSON.stringify({type:"market_state",data:snapshot()}));ws.on("message",raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}handleControlAction(m)});ws.on("close",()=>{if(![...wss.clients].some(c=>c.readyState===WebSocket.OPEN))setTimeout(()=>{if(![...wss.clients].some(c=>c.readyState===WebSocket.OPEN)&&Date.now()>httpLeaseUntil)stop()},13000)})});
server.listen(PORT,()=>console.log("MAIN MARKET single-pair Radar listening on "+PORT));
