import { MIN_CLOSED_CANDLES,HISTORY_CANDLES,MAX_CANDLE_AGE_SECONDS,ANALOGUE_PATTERN_CANDLES,ANALOGUE_TOP_K,ANALOGUE_MIN_MATCHES,DIRECTIONAL_THRESHOLD } from "./config.js";
const finite=Number.isFinite, mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function consecutive(c,s,n){for(let i=s+1;i<s+n;i++)if(c[i].epoch-c[i-1].epoch!==60)return false;return true;}
function features(c,s,n){
 const w=c.slice(s,s+n),r=[];for(let i=1;i<w.length;i++)r.push(Math.log(w[i].close/w[i-1].close));
 const scale=Math.sqrt(mean(r.map(x=>x*x)))||1e-9;
 return [...r.map(x=>Math.max(-5,Math.min(5,x/scale))),...w.flatMap(x=>{const z=Math.max(x.high-x.low,1e-12);return [(x.close-x.open)/z,(x.close-x.low)/z];})];
}
function dist(a,b){return Math.sqrt(mean(a.map((x,i)=>(x-b[i])**2)));}
function fail(reason,extra={}){return {signal:"STANDBY",reason,metrics:null,evidence:[],dataMode:"UNAVAILABLE",...extra};}
export function simulateHistoricalAnalogues(input,{now=Date.now(),tickAgeSeconds=null,allowRestFallback=false}={}){
 if(!Array.isArray(input))return fail("ไม่มีข้อมูลแท่งเทียน");
 const minute=Math.floor(now/60000)*60,closed=input.filter(c=>c&&c.live!==true&&finite(c.epoch)&&c.epoch<minute);
 if(closed.length<MIN_CLOSED_CANDLES)return fail(`แท่ง M1 ที่ปิดแล้วไม่ครบ ${MIN_CLOSED_CANDLES} แท่ง (${closed.length}/${MIN_CLOSED_CANDLES})`,{closedCandleCount:closed.length,requiredCandles:MIN_CLOSED_CANDLES});
 const c=closed.slice(-HISTORY_CANDLES);
 for(let i=0;i<c.length;i++){const x=c[i];if(![x.open,x.high,x.low,x.close].every(finite)||x.low<=0||x.close<=0||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)||x.high<x.low)return fail("ข้อมูล OHLC ผิดปกติ");if(i&&x.epoch<=c[i-1].epoch)return fail("เวลาแท่งเทียนซ้ำหรือไม่เรียงตามลำดับ");}
 const last=c.at(-1),age=Math.max(0,now/1000-(last.epoch+60));
 if(age>MAX_CANDLE_AGE_SECONDS)return fail("แท่งเทียนล่าสุดเก่าเกินกำหนด",{ageSeconds:Math.round(age)});
 const n=ANALOGUE_PATTERN_CANDLES,cs=c.length-n;
 if(!consecutive(c,cs,n))return fail("แท่ง M1 ล่าสุดไม่ต่อเนื่อง — รอข้อมูลดิบที่สมบูรณ์");
 const stream=finite(tickAgeSeconds)&&tickAgeSeconds>=0&&tickAgeSeconds<=25,rest=allowRestFallback&&age<=MAX_CANDLE_AGE_SECONDS;
 if(!stream&&!rest)return fail("ยังไม่มีราคา Streaming สดหรือ REST fallback ที่ผ่าน Data Quality Gate",{lastPrice:last.close,lastCandleEpoch:last.epoch,ageSeconds:Math.round(age)});
 const target=features(c,cs,n),matches=[];
 for(let s=0;s+n<cs;s++){if(!consecutive(c,s,n+1))continue;const a=c[s+n-1],b=c[s+n],move=(b.close-a.close)/a.close;if(move===0)continue;matches.push({d:dist(target,features(c,s,n)),up:move>0,move});}
 matches.sort((a,b)=>a.d-b.d);const chosen=matches.slice(0,ANALOGUE_TOP_K);
 const base={analogueCandidates:matches.length,analoguesUsed:chosen.length,patternCandles:n,forecastHorizonCandles:1,directionalThreshold:DIRECTIONAL_THRESHOLD};
 if(chosen.length<ANALOGUE_MIN_MATCHES)return fail(`Historical Analogues มีตัวอย่างที่ใช้ได้เพียง ${chosen.length}/${ANALOGUE_MIN_MATCHES} — ยังไม่พอตัดสินใจ`,{metrics:base,dataMode:stream?"STREAMING":"REST_FALLBACK",lastPrice:last.close,lastCandleEpoch:last.epoch,ageSeconds:Math.round(age)});
 const up=chosen.filter(x=>x.up).length,down=chosen.length-up,upPct=up/chosen.length*100,downPct=down/chosen.length*100;
 let signal="STANDBY",reason=`ผลจำลองยังไม่ถึงเกณฑ์ ${DIRECTIONAL_THRESHOLD}%`;
 if(upPct>=DIRECTIONAL_THRESHOLD&&upPct>downPct){signal="CALL";reason=`CALL: Historical Analogues ขาขึ้น ${upPct.toFixed(1)}% (เกณฑ์ ${DIRECTIONAL_THRESHOLD}%) จาก ${chosen.length} รูปแบบ`;}
 else if(downPct>=DIRECTIONAL_THRESHOLD&&downPct>upPct){signal="PUT";reason=`PUT: Historical Analogues ขาลง ${downPct.toFixed(1)}% (เกณฑ์ ${DIRECTIONAL_THRESHOLD}%) จาก ${chosen.length} รูปแบบ`;}
 const avg=mean(chosen.map(x=>x.d));
 return {signal,regime:"HISTORICAL_ANALOGUE",reason,evidence:[`จับคู่รูปแบบ M1 ล่าสุด ${n} แท่งกับประวัติที่ไม่ทับซ้อน`,`ใช้ ${chosen.length} analogue จาก ${matches.length} ตัวอย่างที่ตรวจพบ`,`ผลแท่งถัดไป: ขึ้น ${up} / ลง ${down}; directional share ไม่ใช่ win probability ที่ calibrate`,`ระยะจำลอง 1 แท่ง M1; mean pattern distance ${avg.toFixed(3)}`],
 metrics:{...base,upwardPercent:+upPct.toFixed(2),downwardPercent:+downPct.toFixed(2),upwardCount:up,downwardCount:down,meanSimilarityDistance:+avg.toFixed(5),meanHistoricalMove:mean(chosen.map(x=>x.move))},
 dataMode:stream?"STREAMING":"REST_FALLBACK",lastPrice:last.close,lastCandleTime:last.time,lastCandleEpoch:last.epoch,ageSeconds:Math.round(age),candleCount:c.length,closedCandleCount:c.length,requiredCandles:MIN_CLOSED_CANDLES,livePriceReady:true,tickAgeSeconds:stream?Math.round(tickAgeSeconds):null,analyzedAt:new Date(now).toISOString()};
}
