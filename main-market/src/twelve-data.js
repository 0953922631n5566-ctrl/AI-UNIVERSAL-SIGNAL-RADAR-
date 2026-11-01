import {MIN_CANDLES,HISTORY_CANDLES} from "./config.js";
const BASE="https://api.twelvedata.com";
export async function fetchCandles({apiKey,symbol="EUR/USD",interval="1min",outputsize=HISTORY_CANDLES}){
 if(!apiKey)throw new Error("TWELVE_DATA_API_KEY is not configured");
 const u=new URL("/time_series",BASE);u.searchParams.set("symbol",symbol);u.searchParams.set("interval",interval);u.searchParams.set("outputsize",String(outputsize));u.searchParams.set("timezone","UTC");
 const r=await fetch(u,{headers:{Authorization:`apikey ${apiKey}`},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error(`Twelve Data HTTP ${r.status}`);
 const b=await r.json();if(b.status==="error"||!Array.isArray(b.values))throw new Error(b.message||"Twelve Data returned no candles");
 const minuteStart=Math.floor(Date.now()/60000)*60;
 const candles=b.values.map(v=>({time:v.datetime,epoch:Date.parse(v.datetime.replace(" ","T")+"Z")/1000,open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)})).filter(c=>Number.isFinite(c.epoch)&&[c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.high>=c.low).reverse();
 // The current 1-minute bar is still forming; only pass fully closed bars to warmup.
 const closedCandles=candles.filter(c=>c.epoch<minuteStart);
 if(closedCandles.length<MIN_CANDLES)throw new Error(`Insufficient CLOSED history: ${closedCandles.length}/${MIN_CANDLES} candles (requested ${outputsize})`);
 return{symbol:b.meta?.symbol||symbol,interval:b.meta?.interval||interval,candles:closedCandles.slice(-HISTORY_CANDLES),receivedAt:Date.now()};
}