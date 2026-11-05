'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const BASE='https://datafeed.dukascopy.com/datafeed/EURUSD';
const RAW=path.resolve('data/historical/raw/EURUSD');
const MANIFEST=path.resolve('data/historical/download-manifest.json');
const MAX_DAYS=7, PAUSE_MS=Number(process.env.HISTORICAL_DOWNLOAD_PAUSE_MS||1000);
const MAX_RETRIES=Number(process.env.HISTORICAL_DOWNLOAD_RETRIES||8);
const REQUEST_TIMEOUT_MS=Number(process.env.HISTORICAL_DOWNLOAD_TIMEOUT_MS||60000);
const MIN_COVERAGE_PCT=Number(process.env.HISTORICAL_MIN_COVERAGE_PCT||50);
function dateArg(v,n){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||Number.isNaN(Date.parse(v+'T00:00:00Z')))throw Error(n+' must be YYYY-MM-DD');return new Date(v+'T00:00:00Z');}
function pad(n){return String(n).padStart(2,'0');}
function targetFor(t){return path.join(RAW,String(t.getUTCFullYear()),pad(t.getUTCMonth()),pad(t.getUTCDate()),pad(t.getUTCHours())+'h_ticks.bi5');}
function expectedWeekdayHours(from,to){let n=0;for(let d=new Date(from);d<=to;d.setUTCDate(d.getUTCDate()+1)){const w=d.getUTCDay();if(w>=1&&w<=5)n+=24;}return n;}
function summarizeCoverage(from,to,c){const expected=expectedWeekdayHours(from,to),available=c.downloaded+c.cached;return{expectedWeekdayHours:expected,availableHours:available,missingProviderHours:c.missingProvider,failedAfterRetriesHours:c.failedAfterRetries,coveragePct:expected?Math.round(available/expected*10000)/100:100,minimumCoveragePct:MIN_COVERAGE_PCT};}
async function fetchHour(hour,force){
 const target=targetFor(hour);if(!force&&fs.existsSync(target)&&fs.statSync(target).size>0)return{status:'cached'};
 const y=hour.getUTCFullYear(),m=pad(hour.getUTCMonth()),d=pad(hour.getUTCDate()),h=pad(hour.getUTCHours());
 const url=BASE+'/'+y+'/'+m+'/'+d+'/'+h+'h_ticks.bi5';let last=null;
 for(let attempt=1;attempt<=MAX_RETRIES;attempt++){
  try{
   const r=await fetch(url,{headers:{'User-Agent':'AI-Universal-Signal-Radar historical research downloader'},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
   if(r.status===404)return{status:'missingProvider',reason:'HTTP 404'};
   if(!r.ok){const e=Error('HTTP '+r.status);e.status=r.status;e.retryAfter=r.headers.get('retry-after');throw e;}
   const bytes=Buffer.from(await r.arrayBuffer());if(!bytes.length)return{status:'missingProvider',reason:'empty response'};
   fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.part';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,target);return{status:'downloaded'};
  }catch(e){
   last=e;const s=Number(e.status||0),retryable=!s||s===408||s===425||s===429||s>=500;
   if(!retryable||attempt===MAX_RETRIES)break;
   const ra=e.retryAfter&&/^\d+$/.test(e.retryAfter)?Number(e.retryAfter)*1000:0;
   const wait=Math.max(ra,Math.min(60000,2000*2**(attempt-1)));
   console.warn('Retry '+attempt+'/'+MAX_RETRIES+' in '+wait+'ms for '+url+' ('+e.message+')');await sleep(wait);
  }
 }
 console.warn('Skipping failed hour '+hour.toISOString()+'; continuing ('+(last?.message||'download failed')+')');
 return{status:'failedAfterRetries',reason:last?.message||'download failed'};
}
async function main(){
 const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;},now=new Date();
 const end0=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-1)),start0=new Date(end0);start0.setUTCDate(start0.getUTCDate()-6);
 const from=dateArg(value('--from')||start0.toISOString().slice(0,10),'--from'),to=dateArg(value('--to')||end0.toISOString().slice(0,10),'--to');
 if(to<from)throw Error('--to must be on or after --from');if(Math.round((to-from)/86400000)+1>MAX_DAYS)throw Error('Range limited to '+MAX_DAYS+' days');
 fs.mkdirSync(RAW,{recursive:true});const counts={downloaded:0,cached:0,missingProvider:0,failedAfterRetries:0},missingHours=[],started=Date.now();
 for(let day=new Date(from);day<=to;day.setUTCDate(day.getUTCDate()+1))for(let h=0;h<24;h++){
  const hour=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),h)),r=await fetchHour(hour,args.includes('--force'));counts[r.status]++;
  if(r.status==='downloaded')process.stdout.write('Downloaded '+hour.toISOString()+'\n');
  if(r.status==='missingProvider'||r.status==='failedAfterRetries')missingHours.push({hour:hour.toISOString(),status:r.status,reason:r.reason||null});
  await sleep(PAUSE_MS);
 }
 const coverage=summarizeCoverage(from,to,counts),manifest={source:'Dukascopy public historical datafeed',instrument:'EUR/USD',timezone:'UTC',dateRange:{from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)},hourlyFiles:counts,coverage,missingHours,generatedAt:new Date().toISOString()};
 fs.mkdirSync(path.dirname(MANIFEST),{recursive:true});fs.writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({...manifest,manifestPath:MANIFEST,elapsedSeconds:Math.round((Date.now()-started)/1000)},null,2));
 if(coverage.coveragePct<MIN_COVERAGE_PCT)throw Error('Coverage '+coverage.coveragePct+'% below minimum '+MIN_COVERAGE_PCT+'%; data retained');
}
if(require.main===module)main().catch(e=>{console.error('Historical download failed: '+e.message);process.exitCode=1;});
module.exports={expectedWeekdayHours,summarizeCoverage,MAX_DAYS};
