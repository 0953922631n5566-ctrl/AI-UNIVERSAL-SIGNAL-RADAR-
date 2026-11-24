import { twelveDataKeyPool } from "./twelve-data-pool.js";
import {
  HISTORY_CANDLES,
  MIN_CLOSED_CANDLES,
  SYMBOLS,
  normalizeSymbol
} from "./config.js";

const API_BASE = "https://api.twelvedata.com";
const REQUEST_TIMEOUT_MS = 15000;

function providerError(symbol, body, status) {
  const message = String(body?.message || body?.code || `HTTP ${status}`);
  const error = new Error(`${symbol}: ${message}`);
  error.status = status;
  error.providerCode = body?.code ?? null;
  error.kind = /quota|credit|rate.?limit/i.test(message) || status === 429
    ? "RATE_LIMIT"
    : status === 401 || status === 403
      ? "AUTH_OR_PERMISSION"
      : /symbol|not found|not supported|not available|subscription|plan/i.test(message)
        ? "PAIR_UNAVAILABLE"
        : "PROVIDER_ERROR";
  return error;
}

function parseCandle(value) {
  const epoch = Date.parse(String(value.datetime).replace(" ", "T") + "Z") / 1000;
  const candle = {
    time: String(value.datetime),
    epoch,
    open: Number(value.open),
    high: Number(value.high),
    low: Number(value.low),
    close: Number(value.close),
    live: false
  };
  if (!Number.isFinite(epoch) ||
      ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low) return null;
  return candle;
}

export async function fetchCandles({
  apiKey,
  keyPool = twelveDataKeyPool,
  symbol = "EUR/USD",
  interval = "1min",
  outputsize = HISTORY_CANDLES,
  fetchImpl = fetch,
  now = Date.now()
}) {
  const normalized = normalizeSymbol(symbol);
  const allowed = SYMBOLS.some(item => normalizeSymbol(item) === normalized);
  if (!allowed) throw new Error(`Pair is not enabled: ${symbol}`);
  const candidateKeys = apiKey ? [apiKey] : (keyPool.getRestCandidates?.() || keyPool.getCandidates());
  if (!candidateKeys.length) {
    const error = new Error("No Twelve Data API keys are currently available");
    error.kind = "RATE_LIMIT";
    throw error;
  }

  const url = new URL("/time_series", API_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("timezone", "UTC");

  let body;
  let response;
  let lastError = null;
  let successfulKey = null;
  for (const candidateKey of candidateKeys) {
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `apikey ${candidateKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      try { body = await response.json(); }
      catch {
        const error = new Error(`Twelve Data returned invalid JSON for ${symbol}`);
        error.kind = "INVALID_RESPONSE";
        throw error;
      }
      if (!response.ok || body?.status === "error" || !Array.isArray(body?.values)) {
        throw providerError(symbol, body, response.status);
      }
      successfulKey = candidateKey;
      break;
    } catch (caught) {
      const error = caught?.kind ? caught : (() => {
        const wrapped = new Error(`Twelve Data network error for ${symbol}: ${caught.message}`);
        wrapped.kind = "NETWORK_ERROR";
        return wrapped;
      })();
      lastError = error;
      if (error.kind === "PAIR_UNAVAILABLE" || error.kind === "INSUFFICIENT_HISTORY") throw error;
      if (!apiKey) keyPool.markFailure(candidateKey, error);
    }
  }
  if (!successfulKey) throw lastError || new Error("Twelve Data API pool failed");
  if (!apiKey) {
    if (typeof keyPool.markRestSuccess === "function") keyPool.markRestSuccess(successfulKey);
    else keyPool.markSuccess(successfulKey);
  }

  const minuteStart = Math.floor(now / 60000) * 60;
  const byEpoch = new Map();
  for (const raw of body.values) {
    const candle = parseCandle(raw);
    if (!candle || candle.epoch >= minuteStart) continue;
    byEpoch.set(candle.epoch, candle);
  }

  const candles = [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch);
  if (candles.length < MIN_CLOSED_CANDLES) {
    const error = new Error(
      `${symbol}: insufficient closed M1 candles ${candles.length}/${MIN_CLOSED_CANDLES}`
    );
    error.kind = "INSUFFICIENT_HISTORY";
    throw error;
  }

  return {
    symbol: body.meta?.symbol || symbol,
    interval: body.meta?.interval || interval,
    candles: candles.slice(-HISTORY_CANDLES),
    receivedAt: now,
    source: "Twelve Data REST"
  };
}


/** Fetch a provider-calculated native indicator series; no local indicator math. */
async function fetchNativeIndicator({endpoint,field,period,symbol="EUR/USD",interval="1min",outputsize=6,requiredValues=4,keyPool=twelveDataKeyPool,fetchImpl=fetch,now=Date.now()}){
 const normalized=normalizeSymbol(symbol);
 if(!SYMBOLS.some(item=>normalizeSymbol(item)===normalized))throw new Error(`Pair is not enabled: ${symbol}`);
 const keys=keyPool.getRestCandidates?.()||keyPool.getCandidates();
 if(!keys.length){const e=new Error(`No Twelve Data API keys available for ${endpoint}(${period})`);e.kind="RATE_LIMIT";throw e;}
 const url=new URL(`/${endpoint}`,API_BASE);
 for(const [k,v] of Object.entries({symbol,interval,time_period:String(period),outputsize:String(outputsize),order:"desc",timezone:"UTC"}))url.searchParams.set(k,v);
 if(endpoint==="ema")url.searchParams.set("series_type","close");
 let body,success=null,last=null;
 for(const key of keys){
  try{
   const response=await fetchImpl(url,{headers:{Authorization:`apikey ${key}`},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
   try{body=await response.json();}catch{const e=new Error(`Twelve Data returned invalid ${endpoint} JSON`);e.kind="INVALID_RESPONSE";throw e;}
   if(!response.ok||body?.status==="error"||!Array.isArray(body?.values))throw providerError(symbol,body,response.status);
   success=key;break;
  }catch(caught){
   const error=caught?.kind?caught:(()=>{const e=new Error(`Twelve Data ${endpoint} network error: ${caught.message}`);e.kind="NETWORK_ERROR";return e;})();
   last=error;
   if(error.kind==="PAIR_UNAVAILABLE"||error.kind==="INSUFFICIENT_HISTORY")throw error;
   keyPool.markFailure(key,error);
  }
 }
 if(!success)throw last||new Error(`Twelve Data ${endpoint} pool failed`);
 if(typeof keyPool.markRestSuccess==="function")keyPool.markRestSuccess(success);else keyPool.markSuccess(success);
 const current=Math.floor(now/60000)*60,byEpoch=new Map();
 for(const raw of body.values){
  const epoch=Date.parse(String(raw?.datetime||"").replace(" ","T")+"Z")/1000;
  const value=Number(raw?.[field]);
  if(Number.isFinite(epoch)&&Number.isFinite(value)&&epoch<current)byEpoch.set(epoch,{epoch,value});
 }
 const values=[...byEpoch.values()].sort((a,b)=>a.epoch-b.epoch).slice(-requiredValues);
 if(values.length!==requiredValues||values.some((v,i)=>i>0&&v.epoch-values[i-1].epoch!==60)){
  const e=new Error(`${symbol}: Twelve Data ${endpoint}(${period}) needs ${requiredValues} consecutive completed M1 values`);e.kind="INSUFFICIENT_HISTORY";throw e;
 }
 return{symbol:body.meta?.symbol||symbol,interval:body.meta?.interval||interval,endpoint,period,values:values.map(v=>({epoch:v.epoch,[field]:v.value})),receivedAt:now,source:`Twelve Data /${endpoint}`};
}
export const fetchTrendEma5 = options => fetchNativeIndicator({...options,endpoint:"ema",field:"ema",period:5});
export const fetchEma20 = options => fetchNativeIndicator({...options,endpoint:"ema",field:"ema",period:20});
export const fetchAtr14 = options => fetchNativeIndicator({...options,endpoint:"atr",field:"atr",period:14,outputsize:40,requiredValues:34});
