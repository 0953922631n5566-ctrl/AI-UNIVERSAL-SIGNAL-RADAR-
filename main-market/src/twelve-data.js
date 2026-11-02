import {MIN_CANDLES,HISTORY_CANDLES,normalizeSymbol,SYMBOLS} from "./config.js";
const BASE="https://api.twelvedata.com";
export async function fetchCandles({apiKey,symbol="EUR/USD",interval="1min",outputsize=HISTORY_CANDLES}){
 const pair=normalizeSymbol(symbol);
 if(!SYMBOLS.some(s=>normalizeSymbol(s)===pair))throw new Error("Pair is not enabled in this application: "+symbol);
 if(!apiKey)throw new Error("TWELVE_DATA_API_KEY is not configured");
 const u=new URL("/time_series",BASE);u.searchParams.set("symbol",symbol);u.searchParams.set("interval",interval);u.searchParams.set("outputsize",String(outputsize));u.searchParams.set("timezone","UTC");
 const r=await fetch(u,{headers:{Authorization:`apikey ${apiKey}`},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Twelve Data HTTP ${r.status} for ${symbol}`);
 const b=await r.json();
 if(b.status==="error"||!Array.isArray(b.values)){
  const message=String(b.message||b.code||"Twelve Data returned no candles");
  throw new Error(`${symbol}: ${message}`);
 }
 const minuteStart=Math.floor(Date.now()/60000)*60;
 const candles=b.values.map(v=>({time:v.datetime,epoch:Date.parse(v.datetime.replace(" ","T")+"Z")/1000,open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)})).filter(c=>Number.isFinite(c.epoch)&&[c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.high>=c.low).reverse();
 const closedCandles=candles.filter(c=>c.epoch<minuteStart);
 if(closedCandles.length<MIN_CANDLES)throw new Error(`${symbol}: insufficient CLOSED history ${closedCandles.length}/${MIN_CANDLES} (requested ${outputsize})`);
 return{symbol:b.meta?.symbol||symbol,interval:b.meta?.interval||interval,candles:closedCandles.slice(-HISTORY_CANDLES),receivedAt:Date.now()};
}
