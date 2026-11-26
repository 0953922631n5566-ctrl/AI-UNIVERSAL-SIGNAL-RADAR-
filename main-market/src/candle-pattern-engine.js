const API_BASE = "https://api.twelvedata.com";
const PAGE_SIZE = 5000;
const PATTERN_LENGTH = 8;
const FEATURE_COUNT = 5;
const STRIDE = 3;
const TOP_K = 30;
const MIN_MATCHES = 12;

function parseEpoch(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const epoch = Date.parse(normalized) / 1000;
  return Number.isFinite(epoch) ? epoch : NaN;
}

function parseCandle(raw) {
  const epoch = parseEpoch(raw?.datetime);
  const candle = { epoch, open: Number(raw?.open), high: Number(raw?.high), low: Number(raw?.low), close: Number(raw?.close) };
  if (!Number.isFinite(epoch) || ![candle.open,candle.high,candle.low,candle.close].every(Number.isFinite)) return null;
  if (candle.high < Math.max(candle.open,candle.close) || candle.low > Math.min(candle.open,candle.close) || candle.high < candle.low) return null;
  return candle;
}
function utcDate(epoch) { return new Date(epoch * 1000).toISOString().slice(0,19).replace("T"," "); }
function trueRange(c, previousClose) {
  return Math.max(c.high-c.low, Math.abs(c.high-previousClose), Math.abs(c.low-previousClose));
}
function median(values) {
  if (!values.length) return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
function scaleBefore(candles,start) {
  const ranges=[];
  for(let i=Math.max(1,start-14);i<start;i++) ranges.push(trueRange(candles[i],candles[i-1].close));
  return Math.max(median(ranges),1e-8);
}
function encodePattern(candles,start) {
  const scale=scaleBefore(candles,start);
  const out=new Float32Array(PATTERN_LENGTH*FEATURE_COUNT);
  let p=0;
  for(let j=0;j<PATTERN_LENGTH;j++){
    const c=candles[start+j],range=Math.max(c.high-c.low,scale*0.02);
    const body=c.close-c.open;
    const upper=c.high-Math.max(c.open,c.close);
    const lower=Math.min(c.open,c.close)-c.low;
    const closeLocation=((c.close-c.low)/range)*2-1;
    out[p++]=body/scale;
    out[p++]=upper/scale;
    out[p++]=lower/scale;
    out[p++]=range/scale;
    out[p++]=closeLocation;
  }
  return out;
}

/**
 * Fetch a chronological EUR/USD M1 history in 5,000-candle pages.
 * Each successful page advances the shared Twelve Data REST key pool.
 */
export async function loadCandleHistory({keyPool,symbol="EUR/USD",targetCandles=100000,fetchImpl=fetch,now=Date.now(),onProgress=()=>{}}) {
  const target=Math.max(1000,Math.min(200000,Math.floor(Number(targetCandles)||100000)));
  const minuteStart=Math.floor(now/60000)*60;
  const byEpoch=new Map();
  let endDate=null,pages=0,previousOldest=Infinity;
  const maxPages=Math.ceil(target/PAGE_SIZE)+3;
  while(byEpoch.size<target && pages<maxPages){
    const outputsize=Math.min(PAGE_SIZE,target-byEpoch.size);
    const url=new URL("/time_series",API_BASE);
    url.searchParams.set("symbol",symbol);
    url.searchParams.set("interval","1min");
    url.searchParams.set("outputsize",String(outputsize));
    url.searchParams.set("timezone","UTC");
    url.searchParams.set("order","DESC");
    if(endDate)url.searchParams.set("end_date",endDate);
    const candidates=keyPool.getRestCandidates?.()||keyPool.getCandidates?.()||[];
    if(!candidates.length)throw new Error("Twelve Data API pool: ไม่มีคีย์ที่พร้อมใช้งาน");
    let body=null,lastError=null,successKey=null;
    for(const key of candidates){
      try{
        const response=await fetchImpl(url,{headers:{Authorization:`apikey ${key}`},signal:AbortSignal.timeout(20000)});
        body=await response.json();
        if(!response.ok||body?.status==="error"||!Array.isArray(body?.values)){
          const message=String(body?.message||body?.code||`HTTP ${response.status}`);
          const error=new Error(message);
          error.kind=/quota|credit|rate.?limit/i.test(message)||response.status===429?"RATE_LIMIT":response.status===401||response.status===403?"AUTH_OR_PERMISSION":"PROVIDER_ERROR";
          throw error;
        }
        successKey=key;break;
      }catch(error){
        lastError=error;
        keyPool.markFailure?.(key,error);
      }
    }
    if(!successKey)throw lastError||new Error("Twelve Data history request failed");
    if(keyPool.markRestSuccess)keyPool.markRestSuccess(successKey);else keyPool.markSuccess?.(successKey);
    pages++;
    const page=body.values.map(parseCandle).filter(c=>c&&c.epoch<minuteStart).sort((a,b)=>a.epoch-b.epoch);
    if(!page.length)break;
    const oldest=page[0].epoch;
    if(oldest>=previousOldest)break;
    previousOldest=oldest;
    for(const candle of page)byEpoch.set(candle.epoch,candle);
    onProgress({pages,loadedCandles:byEpoch.size,targetCandles:target,oldestEpoch:oldest,newestEpoch:page.at(-1).epoch});
    if(page.length<Math.min(PAGE_SIZE,outputsize))break;
    endDate=utcDate(oldest-60);
  }
  const candles=[...byEpoch.values()].sort((a,b)=>a.epoch-b.epoch).slice(-target);
  if(candles.length<PATTERN_LENGTH+16)throw new Error(`ข้อมูลย้อนหลังไม่เพียงพอ: ${candles.length} แท่ง`);
  return {candles,pages,requestedCandles:target,loadedCandles:candles.length,oldestEpoch:candles[0].epoch,newestEpoch:candles.at(-1).epoch};
}

export function buildCandlePatternModel(candles) {
  const rows=[];
  for(let start=15;start+PATTERN_LENGTH<candles.length-1;start+=STRIDE){
    const next=candles[start+PATTERN_LENGTH];
    const scale=scaleBefore(candles,start);
    const move=next.close-next.open;
    const label=Math.abs(move)<=scale*0.08?0:move>0?1:-1;
    if(label===0)continue;
    rows.push({start,label,nextEpoch:next.epoch,vector:encodePattern(candles,start)});
  }
  const vectors=new Float32Array(rows.length*PATTERN_LENGTH*FEATURE_COUNT);
  const labels=new Int8Array(rows.length);
  const starts=new Int32Array(rows.length);
  const nextEpochs=new Float64Array(rows.length);
  rows.forEach((row,i)=>{
    vectors.set(row.vector,i*PATTERN_LENGTH*FEATURE_COUNT);
    labels[i]=row.label;starts[i]=row.start;nextEpochs[i]=row.nextEpoch;
  });
  return {vectors,labels,starts,nextEpochs,patternCount:rows.length,candleCount:candles.length,firstEpoch:candles[0].epoch,lastEpoch:candles.at(-1).epoch};
}

export function predictNextCandle(model,recentCandles) {
  if(!model||model.patternCount===0)return {signal:"STANDBY",reason:"ยังไม่มีโมเดลรูปแบบแท่งเทียน",matches:0};
  const recent=recentCandles?.slice(-PATTERN_LENGTH);
  if(!recent||recent.length!==PATTERN_LENGTH)return {signal:"STANDBY",reason:"ต้องมีแท่ง M1 ปิดแล้ว 8 แท่ง",matches:0};
  const queryStartEpoch=recent[0].epoch;
  const query=encodePattern(recentCandles.slice(-PATTERN_LENGTH-14),14);
  const top=[];
  const dims=PATTERN_LENGTH*FEATURE_COUNT;
  for(let i=0;i<model.patternCount;i++){
    // The outcome candle must be strictly earlier than the query window: no look-ahead or self-match.
    if(model.nextEpochs[i]>=queryStartEpoch)continue;
    const offset=i*dims;
    let sum=0;
    for(let j=0;j<dims;j++){const d=query[j]-model.vectors[offset+j];sum+=d*d;}
    const distance=Math.sqrt(sum/dims);
    const candidate={i,distance,start:model.starts[i],label:model.labels[i]};
    let pos=0;while(pos<top.length&&top[pos].distance<=distance)pos++;
    if(pos<TOP_K){
      top.splice(pos,0,candidate);
      // Avoid counting many near-identical, overlapping historical windows as independent matches.
      for(let k=top.length-1;k>=0;k--){
        if(k===pos)continue;
        if(Math.abs(top[k].start-candidate.start)<PATTERN_LENGTH)top.splice(k,1);
      }
      if(top.length>TOP_K)top.pop();
    }
  }
  if(top.length<MIN_MATCHES)return {signal:"STANDBY",reason:"รูปแบบที่เทียบได้มีจำนวนไม่พอ",matches:top.length,requiredMatches:MIN_MATCHES};
  let callWeight=0,putWeight=0;
  for(const match of top){
    const weight=1/(match.distance+0.2);
    if(match.label===1)callWeight+=weight;else if(match.label===-1)putWeight+=weight;
  }
  const total=callWeight+putWeight;
  const callRatio=total?callWeight/total*100:0;
  const putRatio=100-callRatio;
  const edge=Math.abs(callRatio-putRatio);
  const signal=callRatio>=56&&edge>=8?"CALL":putRatio>=56&&edge>=8?"PUT":"STANDBY";
  const ratio=Math.round(Math.max(callRatio,putRatio));
  return {
    signal,callRatio:Math.round(callRatio),putRatio:Math.round(putRatio),
    historicalDirectionalRatio:ratio,edge:Math.round(edge),matches:top.length,
    nearestDistance:Number(top[0].distance.toFixed(4)),
    reason:signal==="STANDBY"?"รูปแบบย้อนหลังยังไม่ให้ความได้เปรียบชัดเจน":`พบรูปแบบใกล้เคียง ${top.length} กลุ่ม · ${signal} มีสัดส่วนย้อนหลัง ${ratio}%`,
    modelCandles:model.candleCount,modelPatterns:model.patternCount,
    source:"Twelve Data EUR/USD M1 · 8-candle analogue matching"
  };
}
