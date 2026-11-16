const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
export const BB_PERIOD = 20;
export const BB_DEVIATION = 2;
function valid(xs) { return Array.isArray(xs) && xs.length >= 22 && xs.every(c => c && c.live !== true && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 && c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low); }
function bands(xs, end) { const a=xs.slice(end-19,end+1).map(c=>c.close), m=mean(a), sd=Math.sqrt(mean(a.map(x=>(x-m)**2))); return {middle:m,upper:m+2*sd,lower:m-2*sd,width:m?4*sd/m:0}; }
function shape(c) { const r=Math.max(c.high-c.low,1e-12); return {bodyRatio:Math.abs(c.close-c.open)/r,upperWickRatio:(c.high-Math.max(c.open,c.close))/r,lowerWickRatio:(Math.min(c.open,c.close)-c.low)/r,closeLocation:(c.close-c.low)/r,bullish:c.close>c.open,bearish:c.close<c.open}; }
function pressure(c) { const s=shape(c); return {buying:clamp(.45*(s.bullish?s.bodyRatio:0)+.30*s.closeLocation+.25*s.lowerWickRatio),selling:clamp(.45*(s.bearish?s.bodyRatio:0)+.30*(1-s.closeLocation)+.25*s.upperWickRatio),shape:s}; }
function ema(xs,p) { const k=2/(p+1); let v=xs[0]; const out=[v]; for(let i=1;i<xs.length;i++){v=xs[i]*k+v*(1-k);out.push(v);} return out; }
function rejection(c,b,d) { const p=pressure(c),s=p.shape; if(d==="CALL"){const touched=c.low<=b.lower,reclaimed=c.close>b.lower,rejected=s.lowerWickRatio>=.30&&s.closeLocation>=.55;return {valid:touched&&reclaimed&&rejected&&p.buying>=.48,pressure:p.buying};} const touched=c.high>=b.upper,reclaimed=c.close<b.upper,rejected=s.upperWickRatio>=.30&&s.closeLocation<=.45;return {valid:touched&&reclaimed&&rejected&&p.selling>=.48,pressure:p.selling}; }
export function analyzeBBPureScalper(input) {
 const xs=Array.isArray(input)?input.filter(c=>c&&c.live!==true):[];
 if(!valid(xs)) return {ready:false,signal:"STANDBY",setup:"NONE",strategy:"BB_PURE_SCALPER_STANDALONE",reason:"ต้องมีแท่ง M1 ปิดแล้วและ OHLC ถูกต้องอย่างน้อย 22 แท่ง",evidence:[]};
 const i=xs.length-1,c=xs[i],p=xs[i-1],b=bands(xs,i),pb=bands(xs,i-1),ps=pressure(c),s=ps.shape,closes=xs.map(x=>x.close),e=ema(closes,20),slope=e[i]-e[i-3];
 const expanding=b.width>pb.width*1.04;
 const prior=xs.slice(-4,-1);
 const upperWalk=prior.filter((x,j)=>x.close>bands(xs,xs.length-4+j).upper).length>=2;
 const lowerWalk=prior.filter((x,j)=>x.close<bands(xs,xs.length-4+j).lower).length>=2;
 const bullDrive=slope>0&&expanding&&upperWalk, bearDrive=slope<0&&expanding&&lowerWalk;
 const callNow=rejection(c,b,"CALL"),putNow=rejection(c,b,"PUT");
 let signal="STANDBY",setup="NONE",reason="ยังไม่พบการแตะขอบ BB พร้อมแรงปฏิเสธราคา",confirmed=false;
 if(callNow.valid&&!bearDrive){signal="CALL";setup="IMMEDIATE_REJECTION";reason="แตะ BB ล่างแล้วปิดกลับเข้ากรอบ พร้อมแรงซื้อ";}
 else if(putNow.valid&&!bullDrive){signal="PUT";setup="IMMEDIATE_REJECTION";reason="แตะ BB บนแล้วปิดกลับเข้ากรอบ พร้อมแรงขาย";}
 else { const prevBand=bands(xs,i-1),callPrev=rejection(p,prevBand,"CALL"),putPrev=rejection(p,prevBand,"PUT"); const callConfirm=callPrev.valid&&c.close>p.high&&ps.buying>=.48&&s.closeLocation>=.58; const putConfirm=putPrev.valid&&c.close<p.low&&ps.selling>=.48&&s.closeLocation<=.42;
 if(callConfirm&&!bearDrive){signal="CALL";setup="CONFIRMED_REVERSAL";confirmed=true;reason="แท่งก่อนปฏิเสธ BB ล่าง และแท่งล่าสุดยืนยันทะลุ High พร้อมแรงซื้อ";}
 else if(putConfirm&&!bullDrive){signal="PUT";setup="CONFIRMED_REVERSAL";confirmed=true;reason="แท่งก่อนปฏิเสธ BB บน และแท่งล่าสุดยืนยันทะลุ Low พร้อมแรงขาย";} }
 if(signal==="STANDBY"&&(bullDrive||bearDrive)) reason="กรองสัญญาณกลับตัว: พบ Band Walk และแรงขยายตัวตามเทรนด์";
 return {ready:true,signal,direction:["CALL","PUT"].includes(signal)?signal:null,setup,confirmed,reason,strategy:"BB_PURE_SCALPER_STANDALONE",provider:"LOCAL_BOLLINGER_PRICE_ACTION",evidence:["BB(20,2) Upper "+b.upper.toFixed(5)+" · Middle "+b.middle.toFixed(5)+" · Lower "+b.lower.toFixed(5),"แรงซื้อ "+(ps.buying*100).toFixed(0)+"% · แรงขาย "+(ps.selling*100).toFixed(0)+"%","ไส้บน "+(s.upperWickRatio*100).toFixed(0)+"% · ไส้ล่าง "+(s.lowerWickRatio*100).toFixed(0)+"%","Band width "+b.width.toFixed(5)+" · "+(expanding?"กำลังกว้างขึ้น":"ไม่ขยายตัวเด่นชัด"),"EMA20 slope "+slope.toExponential(2)+" · "+(bullDrive?"UPPER BAND WALK":bearDrive?"LOWER BAND WALK":"ไม่พบ Band Walk ที่ยืนยัน")],metrics:{period:20,deviation:2,upper:b.upper,middle:b.middle,lower:b.lower,bandwidth:b.width,buyingPressure:ps.buying,sellingPressure:ps.selling,upperWickRatio:s.upperWickRatio,lowerWickRatio:s.lowerWickRatio,bandExpanding:expanding,bullishBandWalk:bullDrive,bearishBandWalk:bearDrive,lastClosedCandleEpoch:c.epoch??null},riskFlags:bullDrive||bearDrive?["COUNTER_TREND_BAND_WALK_BLOCK"]:[]};
}