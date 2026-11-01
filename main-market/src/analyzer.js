import {MIN_CANDLES} from "./config.js";
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const pct=(a,b)=>b?a/b*100:0;
export function ema(v,p){if(v.length<p)return null;let x=mean(v.slice(0,p)),k=2/(p+1);for(const n of v.slice(p))x=n*k+x*(1-k);return x}
export function rsi(v,p=14){if(v.length<=p)return null;let g=0,l=0;for(let i=v.length-p;i<v.length;i++){let d=v[i]-v[i-1];if(d>0)g+=d;else l-=d}if(!l)return 100;if(!g)return 0;return 100-100/(1+g/l)}
function macd(v){let line=ema(v,12)-ema(v,26),s=[];for(let i=26;i<=v.length;i++)s.push(ema(v.slice(0,i),12)-ema(v.slice(0,i),26));let signal=ema(s,5);return{line,signal,histogram:line-signal}}
function trs(c){return c.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-c[i].close),Math.abs(x.low-c[i].close)))}
function avgRange(c,n){return mean(trs(c).slice(-n))}
export function analyzeMarket(c,{now=Date.now(),maxAgeSeconds=180,tickAgeSeconds=null}={}){
 const minuteStart=Math.floor(now/60000)*60;
 const closedCount=Array.isArray(c)?c.filter(x=>!x.live&&Number.isFinite(x.epoch)&&x.epoch<minuteStart).length:0;
 if(!Array.isArray(c)||closedCount<MIN_CANDLES)return standby(`ประวัติแท่งเทียนที่ปิดแล้วไม่ครบ ${MIN_CANDLES} แท่ง (${closedCount}/${MIN_CANDLES})`,{closedCandleCount:closedCount,requiredCandles:MIN_CANDLES});
 const last=c.at(-1),age=Number.isFinite(last.epoch)?Math.max(0,now/1000-last.epoch):Infinity;
 if(age>maxAgeSeconds)return standby("ข้อมูลแท่งเทียนล่าช้า",{ageSeconds:Math.round(age)});
 if(tickAgeSeconds===null)return standby("ยังไม่มีราคา Streaming สำหรับยืนยันจังหวะสด");
 if(tickAgeSeconds>25)return standby("ราคา Streaming หยุดอัปเดต",{tickAgeSeconds});
 const v=c.map(x=>x.close),e9=ema(v,9),e21=ema(v,21),e26=ema(v,26),r=rsi(v),m=macd(v),a14=avgRange(c,14),a20=avgRange(c,20);
 if([e9,e21,e26,r,m.line,m.signal,m.histogram,a14,a20].some(x=>!Number.isFinite(x)))return standby("หลักฐานคำนวณไม่ครบ");
 const recent=c.slice(-20),res=Math.max(...recent.slice(0,-1).map(x=>x.high)),sup=Math.min(...recent.slice(0,-1).map(x=>x.low));
 const spread=pct(Math.abs(e9-e21),last.close),range=pct(res-sup,last.close),vol=a20>0?a14/a20:1;
 const up=e9>e21&&e21>e26&&m.histogram>0,down=e9<e21&&e21<e26&&m.histogram<0;
 const high=vol>1.9&&(last.high-last.low)>a14*1.7,side=spread<.012&&range<.11;
 let regime="UNCLEAR";
 if(high)regime="HIGH_VOLATILITY";else if(side)regime="RANGING";else if(up)regime="TRENDING_UP";else if(down)regime="TRENDING_DOWN";
 else if((e9>e21&&c.at(-2).close>e21&&last.close<e21&&r<48&&m.histogram<0)||(e9<e21&&c.at(-2).close<e21&&last.close>e21&&r>52&&m.histogram>0))regime="REVERSAL";
 const nearR=res-last.close<=a14*.35,nearS=last.close-sup<=a14*.35;
 const momentum5=last.close-c.at(-6).close,bodyToAtr=Math.abs(last.close-last.open)/a14;
 const evidence=[`Price action: ${last.close>=last.open?"bullish":"bearish"} body ${bodyToAtr.toFixed(2)} ATR · 5-bar momentum: ${momentum5.toFixed(5)}`,`EMA 9/21/26: ${e9.toFixed(5)} / ${e21.toFixed(5)} / ${e26.toFixed(5)}`,`RSI 14: ${r.toFixed(1)} · MACD histogram: ${m.histogram.toFixed(7)}`,`ATR14/ATR20: ${vol.toFixed(2)} · 20-bar range: ${range.toFixed(4)}%`,`Support: ${sup.toFixed(5)} · Resistance: ${res.toFixed(5)}`];
 let signal="STANDBY",reason="หลักฐานยังไม่สอดคล้องกันหรือยังไม่ยืนยัน";
 if(regime==="TRENDING_UP"&&r>=50&&r<=68&&last.close>e9&&momentum5>0&&!nearR){signal="CALL";reason="แนวโน้มขึ้นและโมเมนตัมสนับสนุน โดยยังไม่ชิดแนวต้าน"}
 else if(regime==="TRENDING_DOWN"&&r>=32&&r<=50&&last.close<e9&&momentum5<0&&!nearS){signal="PUT";reason="แนวโน้มลงและโมเมนตัมสนับสนุน โดยยังไม่ชิดแนวรับ"}
 else if(regime==="RANGING")reason="ตลาดออกข้าง: รอการทะลุกรอบที่ยืนยันได้";
 else if(regime==="HIGH_VOLATILITY")reason="ความผันผวนสูงผิดปกติ: งดไล่ราคา";
 else if(regime==="REVERSAL")reason="พบสัญญาณอาจกลับตัว แต่ต้องรอการยืนยันเพิ่ม";
 else if(nearR||nearS)reason="ราคาอยู่ใกล้แนวรับ/แนวต้าน: ความเสี่ยงไล่ราคาสูง";
 return{signal,regime,reason,evidence,metrics:{ema9:e9,ema21:e21,ema26:e26,rsi14:r,macdLine:m.line,macdSignal:m.signal,macdHistogram:m.histogram,atr14:a14,volatilityRatio:vol,support:sup,resistance:res},lastPrice:last.close,lastCandleTime:last.time,lastCandleEpoch:last.epoch,ageSeconds:Math.round(age),candleCount:c.length,closedCandleCount:closedCount,requiredCandles:MIN_CANDLES,analyzedAt:new Date(now).toISOString()};
}
function standby(reason,extra={}){return{signal:"STANDBY",regime:"UNKNOWN",reason,evidence:[],metrics:null,analyzedAt:new Date().toISOString(),...extra}}