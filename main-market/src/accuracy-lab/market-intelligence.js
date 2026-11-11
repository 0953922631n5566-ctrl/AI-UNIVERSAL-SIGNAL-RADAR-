/**
 * ACCURACY LAB — FULL MARKET INTELLIGENCE (primary signal analyzer).
 * Deterministic M1 diagnostics on CLOSED candles only.
 * This module independently selects the directional setup; it does not call ORIGINAL 84.
 */
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const round=(v,n=2)=>Number(v.toFixed(n));
function ema(values,period){const k=2/(period+1);let v=values[0];return values.map((x,i)=>{if(i)v=x*k+v*(1-k);return v;});}
function valid(c){return Array.isArray(c)&&c.length>=40&&c.every(x=>x&&[x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close)&&x.high>=x.low);}
function trueRanges(c){return c.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-c[i].close),Math.abs(x.low-c[i].close)));}
function averageRange(c,n=14){return mean(trueRanges(c).slice(-n));}
function adxProxy(c,n=14){const rows=c.slice(-(n+1));let plus=0,minus=0,tr=0;for(let i=1;i<rows.length;i++){const up=rows[i].high-rows[i-1].high,down=rows[i-1].low-rows[i].low;plus+=up>down&&up>0?up:0;minus+=down>up&&down>0?down:0;tr+=Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close));}return tr?100*Math.abs(plus-minus)/(plus+minus||1):0;}
function candleShape(x){const range=Math.max(x.high-x.low,Number.EPSILON),body=Math.abs(x.close-x.open);return{range,body,bodyRatio:body/range,upperWick:(x.high-Math.max(x.open,x.close))/range,lowerWick:(Math.min(x.open,x.close)-x.low)/range,closeLocation:(x.close-x.low)/range};}
function classify(c){
 const closes=c.map(x=>x.close),e5=ema(closes,5),e20=ema(closes,20),atr=averageRange(c),last=c.at(-1),prev=c.at(-2),shape=candleShape(last);
 const slope5=(e5.at(-1)-e5.at(-6))/Math.max(atr,1e-12),slope20=(e20.at(-1)-e20.at(-6))/Math.max(atr,1e-12);
 const adx=adxProxy(c),ranges=trueRanges(c),atrFast=mean(ranges.slice(-5)),atrSlow=mean(ranges.slice(-30));
 const recent=c.slice(-12),overlap=recent.slice(1).filter((x,i)=>Math.min(x.high,recent[i].high)>Math.max(x.low,recent[i].low)).length/11;
 const crossCount=closes.slice(-12).filter((v,i,a)=>i>0&&((v-e5.at(-12+i))*(a[i-1]-e5.at(-13+i))<0)).length;
 const compression=atrSlow>0?atrFast/atrSlow:1;
 const sidewayScore=round(100*(.30*clamp((22-adx)/18)+.25*clamp((.22-Math.abs(slope5))/.22)+.25*overlap+.20*clamp((crossCount-1)/5)));
 const volatilityRatio=atrSlow>0?atrFast/atrSlow:1;
 const regime=volatilityRatio>1.85?"HIGH_VOLATILITY":sidewayScore>=62?"SIDEWAY":slope20>.12&&slope5>.035?"UPTREND":slope20<-.12&&slope5<-.035?"DOWNTREND":sidewayScore>=45?"TRANSITION":"UNCLEAR";
 return{closes,e5,e20,atr,adx,slope5,slope20,overlap,crossCount,compression,sidewayScore,regime,shape,last,prev};
}
function analyze(c){
 if(!valid(c))return{ready:false,stage:"INSUFFICIENT_DATA",regime:"UNCLEAR",reason:"ต้องมีแท่ง M1 ที่ปิดแล้วอย่างน้อย 40 แท่ง"};
 const x=classify(c),{last,prev,atr,regime,shape}=x,prior=c.slice(-21,-1),swingHigh=Math.max(...prior.map(v=>v.high)),swingLow=Math.min(...prior.map(v=>v.low));
 const bullish=last.close>last.open,bearish=last.close<last.open;
 const breakoutUp=last.close>swingHigh,breakoutDown=last.close<swingLow;
 const fakeUp=last.high>swingHigh&&last.close<swingHigh,fakeDown=last.low<swingLow&&last.close>swingLow;
 const emaReclaimUp=prev.close<=x.e5.at(-2)&&last.close>x.e5.at(-1),emaReclaimDown=prev.close>=x.e5.at(-2)&&last.close<x.e5.at(-1);
 const pullbackUp=regime==="UPTREND"&&last.low<=x.e5.at(-1)&&last.close>x.e5.at(-1)&&bullish;
 const pullbackDown=regime==="DOWNTREND"&&last.high>=x.e5.at(-1)&&last.close<x.e5.at(-1)&&bearish;
 const trendContinuationUp=regime==="UPTREND"&&bullish&&last.close>prev.high&&x.slope5>0;
 const trendContinuationDown=regime==="DOWNTREND"&&bearish&&last.close<prev.low&&x.slope5<0;
 const reversalCall=fakeDown||(emaReclaimUp&&shape.lowerWick>.32&&x.slope5>-.08);
 const reversalPut=fakeUp||(emaReclaimDown&&shape.upperWick>.32&&x.slope5<.08);
 const breakoutQualityUp=breakoutUp&&bullish&&shape.closeLocation>.72&&shape.bodyRatio>.35;
 const breakoutQualityDown=breakoutDown&&bearish&&shape.closeLocation<.28&&shape.bodyRatio>.35;
 const retestUp=c.slice(-4,-1).some(v=>Math.abs(v.low-swingHigh)<atr*.18)&&last.close>swingHigh;
 const retestDown=c.slice(-4,-1).some(v=>Math.abs(v.high-swingLow)<atr*.18)&&last.close<swingLow;
 const candidates=[
  {direction:"CALL",setup:"REVERSAL",evidence:reversalCall?["พบแรงปฏิเสธราคาด้านล่างหรือ reclaim EMA5"]:[],score:reversalCall?65:0},
  {direction:"PUT",setup:"REVERSAL",evidence:reversalPut?["พบแรงปฏิเสธราคาด้านบนหรือ reclaim EMA5"]:[],score:reversalPut?65:0},
  {direction:"CALL",setup:"PULLBACK",evidence:pullbackUp?["แนวโน้มขึ้นและราคาย่อตัวกลับเหนือ EMA5"]:[],score:pullbackUp?68:0},
  {direction:"PUT",setup:"PULLBACK",evidence:pullbackDown?["แนวโน้มลงและราคาดีดกลับใต้ EMA5"]:[],score:pullbackDown?68:0},
  {direction:"CALL",setup:"CONTINUATION",evidence:trendContinuationUp?["แรงซื้อยืนยันการต่อเนื่องเหนือ high ก่อนหน้า"]:[],score:trendContinuationUp?70:0},
  {direction:"PUT",setup:"CONTINUATION",evidence:trendContinuationDown?["แรงขายยืนยันการต่อเนื่องใต้ low ก่อนหน้า"]:[],score:trendContinuationDown?70:0},
  {direction:"CALL",setup:"BREAKOUT_RETEST",evidence:breakoutQualityUp?["ปิดทะลุ swing high ด้วยแท่งยืนยัน"]:[],score:breakoutQualityUp?(retestUp?82:66):0},
  {direction:"PUT",setup:"BREAKOUT_RETEST",evidence:breakoutQualityDown?["ปิดทะลุ swing low ด้วยแท่งยืนยัน"]:[],score:breakoutQualityDown?(retestDown?82:66):0}
 ];
 const best=candidates.filter(v=>v.score>0).sort((a,b)=>b.score-a.score)[0]||null;
 const blocked=regime==="SIDEWAY"||regime==="HIGH_VOLATILITY"||regime==="TRANSITION"||x.sidewayScore>=62;
 const setup=best&&!blocked&&best.score>=65?best:null;
 const warnings=[];
 if(blocked)warnings.push(regime==="SIDEWAY"?"SIDEWAY GUARD: ตลาดแกว่งในกรอบ":"MARKET GUARD: ตลาดกำลังเปลี่ยนผ่านหรือผันผวนสูง");
 if(fakeUp||fakeDown)warnings.push("ตรวจพบการเบรกหลอกและปิดกลับเข้ากรอบ");
 if(x.adx<16)warnings.push("แรงแนวโน้มต่ำ (ADX proxy)");
 if(x.compression<.72)warnings.push("ความผันผวนหดตัว");
 if(x.compression>1.85)warnings.push("ความผันผวนขยายตัวผิดปกติ");
 const stage=setup?"SETUP_CANDIDATE":blocked?"NO_TRADE_GUARD":"WAIT_CONFIRMATION";
 return{
  ready:true,stage,regime,sidewayScore:x.sidewayScore,adxProxy:round(x.adx),atr:round(atr,8),
  volatilityRatio:round(x.compression),ema5Slope:round(x.slope5,3),ema20Slope:round(x.slope20,3),
  candle:{bodyRatio:round(shape.bodyRatio,2),upperWick:round(shape.upperWick,2),lowerWick:round(shape.lowerWick,2)},
  structure:{swingHigh,swingLow,breakoutUp,breakoutDown,fakeUp,fakeDown,retestUp,retestDown},
  candidates,setup:setup?{direction:setup.direction,type:setup.setup,score:setup.score,evidence:setup.evidence}:null,
  warnings,reason:setup?"พบ setup ที่ควรเฝ้าดู แต่ยังเป็นผลทดสอบ ไม่ใช่คำสั่งเข้าออเดอร์":blocked?"ระบบป้องกันไม่ให้ไล่เข้าในสภาวะตลาดเสี่ยง":"ยังไม่มี setup ที่ผ่านเกณฑ์ รอแท่งยืนยัน"
 };
}
export function analyzeMarketIntelligence(candles){return analyze(candles);}
