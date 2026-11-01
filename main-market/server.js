import "dotenv/config";
import express from "express";import http from "node:http";import WebSocket,{WebSocketServer}from"ws";
import{fetchCandles}from"./src/twelve-data.js";import{analyzeMarket}from"./src/analyzer.js";
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,path:"/live"});
const PORT=Number(process.env.PORT||3000),SYMBOL=process.env.SYMBOL||"EUR/USD",INTERVAL=process.env.INTERVAL||"1min";
const SYNC=Math.max(110,Number(process.env.REST_SYNC_SECONDS||120)),MAXAGE=Number(process.env.MAX_DATA_AGE_SECONDS||180);
let candles=[],upstream=null,restTimer=null,retryTimer=null,heartbeat=null,tickAt=0,lastTick=null,monitoring=false,activeSignal=null,activeUntil=0,signalCandle=null,lastAlertId=null;
const state={signal:"STANDBY",regime:"UNKNOWN",reason:"กดเริ่มเฝ้าระวังเพื่อเชื่อมต่อ Twelve Data",evidence:[],metrics:null,symbol:SYMBOL,interval:INTERVAL,connected:false,monitoring:false,analyzedAt:new Date().toISOString()};
app.use(express.static("public"));
app.get("/health",(_,r)=>r.json({ok:true,service:"main-market",symbol:SYMBOL,interval:INTERVAL,monitoring,streamConnected:!!upstream,apiKeyConfigured:!!process.env.TWELVE_DATA_API_KEY}));
app.get("/api/state",(_,r)=>r.json(state));
function publish(x){Object.assign(state,x,{symbol:SYMBOL,interval:INTERVAL,monitoring,connected:!!upstream});const m=JSON.stringify({type:"market_state",data:state});for(const c of wss.clients)if(c.readyState===WebSocket.OPEN)c.send(m)}
const floorMinute=t=>Math.floor(t/60)*60;
function applyTick(price,epoch){
 const start=floorMinute(epoch),time=new Date(start*1000).toISOString().slice(0,16).replace("T"," ");let cur=candles.at(-1);
 if(!cur||cur.epoch<start){cur={time,epoch:start,open:price,high:price,low:price,close:price,live:true};candles.push(cur);candles=candles.slice(-180)}
 else if(cur.epoch===start){cur.high=Math.max(cur.high,price);cur.low=Math.min(cur.low,price);cur.close=price;cur.live=true}else return;
 tickAt=Date.now();lastTick=price;analyze();
}
function analyze(){
 if(candles.length<60)return;
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
 if(!tickAt)analyze();
}
function startRest(){clearInterval(restTimer);restTimer=setInterval(()=>sync().catch(e=>publish({signal:"STANDBY",regime:"UNKNOWN",reason:"Twelve Data REST: "+e.message,evidence:[],metrics:null,dataError:true})),SYNC*1000)}
function startStream(){
 if(upstream||!monitoring)return;if(!process.env.TWELVE_DATA_API_KEY){publish({signal:"STANDBY",reason:"ยังไม่ได้ตั้ง Twelve Data API Key ฝั่งเซิร์ฟเวอร์"});return}
 startRest();sync().catch(e=>publish({signal:"STANDBY",reason:e.message,evidence:[],metrics:null}));
 upstream=new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey="+encodeURIComponent(process.env.TWELVE_DATA_API_KEY));
 upstream.on("open",()=>{upstream.send(JSON.stringify({action:"subscribe",params:{symbols:SYMBOL}}));heartbeat=setInterval(()=>{if(upstream?.readyState===WebSocket.OPEN)upstream.send(JSON.stringify({action:"heartbeat"}))},10000);publish({signal:"STANDBY",reason:"เชื่อมต่อ Streaming แล้ว กำลังรับราคา",connected:true})});
 upstream.on("message",raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}if(m.event==="price"&&m.symbol===SYMBOL){const p=Number(m.price),t=Number(m.timestamp);if(Number.isFinite(p)&&Number.isFinite(t))applyTick(p,t)}else if(m.status==="error"||m.event==="subscribe-status"&&m.status==="error")publish({signal:"STANDBY",reason:m.message||"บัญชี Twelve Data ไม่อนุญาต Streaming",connected:false})});
 upstream.on("error",e=>publish({signal:"STANDBY",reason:"Streaming error: "+e.message,connected:false}));
 upstream.on("close",()=>{upstream=null;clearInterval(heartbeat);tickAt=0;publish({signal:"STANDBY",reason:"Streaming หลุด: ใช้ REST สำรองและลองเชื่อมใหม่",connected:false});if(monitoring)retryTimer=setTimeout(startStream,8000)});
}
function stop(){
 monitoring=false;clearInterval(restTimer);clearInterval(heartbeat);clearTimeout(retryTimer);const old=upstream;upstream=null;if(old)old.close();activeSignal=null;activeUntil=0;tickAt=0;
 publish({signal:"STANDBY",regime:"UNKNOWN",reason:"หยุดเฝ้าระวังแล้ว",evidence:[],metrics:null,monitoring:false,connected:false});
}
wss.on("connection",ws=>{
 ws.send(JSON.stringify({type:"market_state",data:state}));
 ws.on("message",raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}if(m.action==="start"){monitoring=true;publish({signal:"STANDBY",reason:"กำลังเชื่อมต่อ Twelve Data"});startStream()}if(m.action==="stop")stop()});
 ws.on("close",()=>{if(![...wss.clients].some(c=>c.readyState===WebSocket.OPEN))stop()});
});
server.listen(PORT,()=>console.log("MAIN MARKET Radar listening on "+PORT));