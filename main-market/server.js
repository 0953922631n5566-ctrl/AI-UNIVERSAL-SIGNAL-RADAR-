import "dotenv/config";
import express from "express";import http from "node:http";import path from "node:path";import{fileURLToPath}from"node:url";import WebSocket,{WebSocketServer}from"ws";
import{fetchCandles}from"./src/twelve-data.js";import{analyzeMarket}from"./src/analyzer.js";
const APP_DIR=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,path:"/live"});
const PORT=Number(process.env.PORT||3000),SYMBOL=process.env.SYMBOL||"EUR/USD",INTERVAL=process.env.INTERVAL||"1min";
const SYNC=Math.max(110,Number(process.env.REST_SYNC_SECONDS||120)),MAXAGE=Number(process.env.MAX_DATA_AGE_SECONDS||180);
let candles=[],upstream=null,restTimer=null,retryTimer=null,heartbeat=null,watchdog=null,tickAt=0,lastTick=null,monitoring=false,streamReady=false,dataLocked=false,fatalApiLock=false,lastDataError=null,activeSignal=null,activeUntil=0,signalCandle=null,lastAlertId=null;
const state={signal:"STANDBY",regime:"UNKNOWN",reason:"กดเริ่มเฝ้าระวังเพื่อเชื่อมต่อ Twelve Data",evidence:[],metrics:null,symbol:SYMBOL,interval:INTERVAL,connected:false,monitoring:false,apiStatus:"OFFLINE",dataLocked:false,apiMessage:"ยังไม่ได้เริ่มเชื่อมต่อ API",analyzedAt:new Date().toISOString()};
app.use(express.static(path.join(APP_DIR,"public")));
app.get("/",(_,res)=>res.sendFile(path.join(APP_DIR,"public","index.html")));
app.get("/health",(_,r)=>r.json({ok:true,service:"main-market",symbol:SYMBOL,interval:INTERVAL,monitoring,streamConnected:!!upstream,apiKeyConfigured:!!process.env.TWELVE_DATA_API_KEY}));
app.get("/api/state",(_,r)=>r.json(state));
function publish(x){Object.assign(state,x,{symbol:SYMBOL,interval:INTERVAL,monitoring,connected:streamReady,apiStatus:dataLocked?"LOCKED":streamReady?"ONLINE":monitoring?"CONNECTING":"OFFLINE",dataLocked,apiMessage:lastDataError|| (streamReady?"รับราคา Streaming สดแล้ว":monitoring?"กำลังรอราคา Streaming":"หยุดเฝ้าระวัง")});const m=JSON.stringify({type:"market_state",data:state});for(const c of wss.clients)if(c.readyState===WebSocket.OPEN)c.send(m)}
function isFatalApiError(message){return /\b(401|403|429)\b|quota|credit|rate.?limit|unauthori[sz]ed|invalid api.?key|apikey/i.test(String(message||""))}
function lockData(message,{fatal=false}={}){
 console.error("[market-feed] LOCKED:",String(message||"ข้อมูล API ไม่พร้อม"));
 dataLocked=true;streamReady=false;activeSignal=null;activeUntil=0;lastDataError=String(message||"ข้อมูล API ไม่พร้อม");
 if(fatal)fatalApiLock=true;
 publish({signal:"STANDBY",regime:"UNKNOWN",reason:lastDataError,evidence:[],metrics:null,dataError:true,dataLocked:true});
}
const floorMinute=t=>Math.floor(t/60)*60;
function applyTick(price,epoch){
 const start=floorMinute(epoch),time=new Date(start*1000).toISOString().slice(0,16).replace("T"," ");let cur=candles.at(-1);
 if(!cur||cur.epoch<start){if(cur&&start-cur.epoch>60){candles=[];activeSignal=null;activeUntil=0;signalCandle=null;}cur={time,epoch:start,open:price,high:price,low:price,close:price,live:true};candles.push(cur);candles=candles.slice(-180)}
 else if(cur.epoch===start){cur.high=Math.max(cur.high,price);cur.low=Math.min(cur.low,price);cur.close=price;cur.live=true}else return;
 tickAt=Date.now();lastTick=price;if(!fatalApiLock){streamReady=true;dataLocked=false;lastDataError=null;}analyze();
}
function analyze(){
 if(candles.length<60){publish({signal:"STANDBY",regime:"UNKNOWN",reason:"รับราคา API สดแล้ว — กำลังตรวจสอบประวัติแท่งเทียน "+candles.length+"/60",evidence:[],metrics:null,tickAgeSeconds:Math.round((Date.now()-tickAt)/1000),lastTickPrice:lastTick,source:"Twelve Data live price + REST candles"});return;}
 const age=tickAt?(Date.now()-tickAt)/1000:null;let x=analyzeMarket(candles,{maxAgeSeconds:MAXAGE,tickAgeSeconds:age}),cid=candles.at(-1).epoch;
 if(!x.metrics){activeSignal=null;activeUntil=0;}
 if(x.metrics&&(x.signal==="CALL"||x.signal==="PUT")){
  if(activeSignal&&Date.now()<activeUntil&&activeSignal!==x.signal){x.signal=activeSignal;x.reason="คงทิศทางเดิมระหว่างช่วงป้องกันการสลับสัญญาณ"}
  else if((!activeSignal||Date.now()>=activeUntil)&&signalCandle!==cid){activeSignal=x.signal;activeUntil=Date.now()+40000;signalCandle=cid;lastAlertId=cid+":"+x.signal}
  else if(signalCandle===cid&&activeSignal!==x.signal){x.signal="STANDBY";x.reason="ป้องกันการสลับทิศทางภายในแท่งเทียนเดียวกัน"}
 }else if(x.metrics&&activeSignal&&Date.now()<activeUntil){
  const invalid=activeSignal==="CALL"?(x.regime==="TRENDING_DOWN"||candles.at(-1).close<x.metrics?.ema21):(x.regime==="TRENDING_UP"||candles.at(-1).close>x.metrics?.ema21);
  if(invalid){activeSignal=null;activeUntil=0;x.signal="STANDBY";x.reason="ยกเลิกสัญญาณเดิม: เงื่อนไขตลาดเปลี่ยน"}
  else{x.signal=activeSignal;x.reason="ติดตามสัญญาณเดิมในช่วงถือสัญญาณ 40 วินาที"}
 }else if(Date.now()>=activeUntil)activeSignal=null;
 const epoch=candles.at(-1).epoch;
 publish({...x,tickAgeSeconds:age===null?null:Math.round(age),lastTickPrice:lastTick,signalExpiresAt:activeSignal?new Date(activeUntil).toISOString():null,nextCandleAt:(epoch+60)*1000,alertId:lastAlertId,source:tickAt?"Twelve Data live price + REST candles":"Twelve Data REST"});
}
async function sync(){
 const d=await fetchCandles({apiKey:process.env.TWELVE_DATA_API_KEY,symbol:SYMBOL,interval:INTERVAL,outputsize:120});
 const live=candles.at(-1);candles=live?[...d.candles.filter(c=>c.epoch<live.epoch),live].slice(-180):d.candles.slice(-180);
 fatalApiLock=false;
 console.info("[market-feed] REST history loaded",{symbol:SYMBOL,received:d.candles.length,available:candles.length,liveTickPresent:!!tickAt});
 // REST may finish after the first WebSocket tick. Always re-analyze the merged history.
 analyze();
}
function startRest(){clearInterval(restTimer);restTimer=setInterval(()=>sync().catch(e=>lockData("Twelve Data REST: "+e.message,{fatal:isFatalApiError(e.message)})),SYNC*1000)}
function startStream(){
 if(upstream||!monitoring)return;
 if(!process.env.TWELVE_DATA_API_KEY){lockData("ยังไม่ได้ตั้ง Twelve Data API Key ฝั่งเซิร์ฟเวอร์",{fatal:true});return}
 console.info("[market-feed] START requested",{symbol:SYMBOL,interval:INTERVAL});
 startRest();clearInterval(watchdog);watchdog=setInterval(()=>{if(monitoring&&(!tickAt||Date.now()-tickAt>25000)&&!dataLocked){lockData("ไม่มีราคา Streaming ใหม่ภายใน 25 วินาที");if(upstream)upstream.close()}},5000);
 sync().catch(e=>{console.error("[market-feed] REST sync failed:",e.message);lockData("Twelve Data REST: "+e.message,{fatal:isFatalApiError(e.message)})});
 let ws;
 try{ws=new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey="+encodeURIComponent(process.env.TWELVE_DATA_API_KEY));upstream=ws}
 catch(e){lockData("สร้างการเชื่อมต่อ Twelve Data Streaming ไม่สำเร็จ: "+e.message);retryTimer=setTimeout(startStream,8000);return}
 ws.on("open",()=>{if(upstream!==ws)return;console.info("[market-feed] Twelve Data WebSocket OPEN; subscribing",SYMBOL);streamReady=false;ws.send(JSON.stringify({action:"subscribe",params:{symbols:SYMBOL}}));heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:"heartbeat"}))},10000);publish({signal:"STANDBY",reason:"เชื่อมต่อช่องทางแล้ว — รอราคา API สดเพื่อปลดล็อก",connected:false})});
 ws.on("message",raw=>{if(upstream!==ws)return;let m;try{m=JSON.parse(raw.toString())}catch{return}if(m.event==="price"&&m.symbol===SYMBOL){const p=Number(m.price),t=Number(m.timestamp);if(Number.isFinite(p)&&Number.isFinite(t)){if(!tickAt)console.info("[market-feed] First live price received",SYMBOL);applyTick(p,t)}}else if(m.status==="error"||m.event==="subscribe-status"&&m.status==="error"){const msg=m.message||m.code||"บัญชี Twelve Data ปฏิเสธ Streaming";console.error("[market-feed] Twelve Data subscription error:",msg);lockData("Twelve Data: "+msg,{fatal:isFatalApiError(msg)});if(upstream)upstream.close()}});
 ws.on("error",e=>{if(upstream!==ws)return;console.error("[market-feed] WebSocket error:",e.message);lockData("เชื่อมต่อ Streaming ไม่สำเร็จ: "+e.message,{fatal:isFatalApiError(e.message)})});
 ws.on("close",()=>{console.warn("[market-feed] WebSocket CLOSED");if(upstream!==ws&&upstream!==null)return;if(upstream===ws)upstream=null;streamReady=false;clearInterval(heartbeat);tickAt=0;if(!monitoring)return;if(!dataLocked)lockData("Streaming หลุดหรืออินเทอร์เน็ตขาด — ระบบหยุดออกสัญญาณและกำลังลองเชื่อมใหม่");retryTimer=setTimeout(startStream,8000)});
}
function stop(){
 monitoring=false;streamReady=false;dataLocked=false;lastDataError=null;lastAlertId=null;signalCandle=null;clearInterval(restTimer);clearInterval(heartbeat);clearInterval(watchdog);clearTimeout(retryTimer);const old=upstream;upstream=null;if(old)old.close();activeSignal=null;activeUntil=0;tickAt=0;
 publish({signal:"STANDBY",regime:"UNKNOWN",reason:"หยุดเฝ้าระวังแล้ว",evidence:[],metrics:null,monitoring:false,connected:false});
}
wss.on("connection",ws=>{
 ws.send(JSON.stringify({type:"market_state",data:state}));
 ws.on("message",raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}if(m.action==="start"){monitoring=true;streamReady=false;dataLocked=false;lastDataError=null;lastAlertId=null;signalCandle=null;activeSignal=null;activeUntil=0;publish({signal:"STANDBY",reason:"กำลังเชื่อมต่อ Twelve Data"});startStream()}if(m.action==="stop")stop()});
 ws.on("close",()=>{if(![...wss.clients].some(c=>c.readyState===WebSocket.OPEN))stop()});
});
server.listen(PORT,()=>console.log("MAIN MARKET Radar listening on "+PORT));