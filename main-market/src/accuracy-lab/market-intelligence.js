/**
 * ACCURACY LAB — TREND ONLY signal authority.
 * Closed M1 candles only. Direction requires structure, EMA alignment and trend strength.
 * Counter-trend reversal setups are never eligible for CALL/PUT.
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
 const volatilityRatio=atrSlow>0?atrFast/atrSlow:1;
 const sidewayScore=round(100*(.30*clamp((22-adx)/18)+.25*clamp((.22-Math.abs(slope5))/.22)+.25*overlap+.20*clamp((crossCount-1)/5)));
 // Confirm both swing highs and swing lows: HH+HL for uptrend, LH+LL for downtrend.
 const prior=c.slice(-12,-6),recentBlock=c.slice(-6);
 const priorHigh=Math.max(...prior.map(x=>x.high)),recentHigh=Math.max(...recentBlock.map(x=>x.high));
 const priorLow=Math.min(...prior.map(x=>x.low)),recentLow=Math.min(...recentBlock.map(x=>x.low));
 const eps=Math.max(atr*.03,1e-12);
 const higherHigh=recentHigh>priorHigh+eps,higherLow=recentLow>priorLow+eps;
 const lowerHigh=recentHigh<priorHigh-eps,lowerLow=recentLow<priorLow-eps;
 const matureUpStructure=higherHigh&&higherLow,matureDownStructure=lowerHigh&&lowerLow;
 // Detect the first orderly sequence before the slower six-candle swing structure fully forms.
 const recent3=c.slice(-3),prior3=c.slice(-6,-3);
 const upSequence=recent3.filter(v=>v.close>v.open).length>=2&&recent3.at(-1).close>recent3.at(-2).close&&recent3.at(-2).close>recent3.at(-3).close;
 const downSequence=recent3.filter(v=>v.close<v.open).length>=2&&recent3.at(-1).close<recent3.at(-2).close&&recent3.at(-2).close<recent3.at(-3).close;
 const prior3Low=Math.min(...prior3.map(v=>v.low)),recent3Low=Math.min(...recent3.map(v=>v.low));
 const prior3High=Math.max(...prior3.map(v=>v.high)),recent3High=Math.max(...recent3.map(v=>v.high));
 const earlyUpStructure=upSequence&&recent3Low>=prior3Low-atr*.18;
 const earlyDownStructure=downSequence&&recent3High<=prior3High+atr*.18;
 const ema5TurningUp=slope5>.025&&e5.at(-1)>=e20.at(-1)-atr*.12;
 const ema5TurningDown=slope5<-.025&&e5.at(-1)<=e20.at(-1)+atr*.12;
 const earlyUptrend=volatilityRatio<=1.85&&sidewayScore<55&&adx>=12&&ema5TurningUp&&last.close>e5.at(-1)&&earlyUpStructure;
 const earlyDowntrend=volatilityRatio<=1.85&&sidewayScore<55&&adx>=12&&ema5TurningDown&&last.close<e5.at(-1)&&earlyDownStructure;
 const upStructure=matureUpStructure||earlyUpStructure,downStructure=matureDownStructure||earlyDownStructure;
 const uptrend=volatilityRatio<=1.85&&sidewayScore<55&&((adx>=16&&slope5>.035&&slope20>.12&&e5.at(-1)>e20.at(-1)&&matureUpStructure)||earlyUptrend);
 const downtrend=volatilityRatio<=1.85&&sidewayScore<55&&((adx>=16&&slope5<-.035&&slope20<-.12&&e5.at(-1)<e20.at(-1)&&matureDownStructure)||earlyDowntrend);
 const regime=volatilityRatio>1.85?"HIGH_VOLATILITY":uptrend?"UPTREND":downtrend?"DOWNTREND":sidewayScore>=55||adx<12?"SIDEWAY":"TRANSITION";
 return{closes,e5,e20,atr,adx,slope5,slope20,overlap,crossCount,volatilityRatio,sidewayScore,regime,shape,last,prev,upSequence,downSequence,earlyUptrend,earlyDowntrend,structure:{priorHigh,recentHigh,priorLow,recentLow,higherHigh,higherLow,lowerHigh,lowerLow,upStructure,downStructure,matureUpStructure,matureDownStructure,earlyUpStructure,earlyDownStructure}};
}
function analyze(c){
 if(!valid(c))return{ready:false,stage:"INSUFFICIENT_DATA",regime:"UNCLEAR",setup:null,reason:"ต้องมีแท่ง M1 ที่ปิดแล้วอย่างน้อย 40 แท่ง"};
 const x=classify(c),{last,prev,atr,regime,shape}=x,prior=c.slice(-21,-1),swingHigh=Math.max(...prior.map(v=>v.high)),swingLow=Math.min(...prior.map(v=>v.low));
 const bullish=last.close>last.open,bearish=last.close<last.open;
 const breakoutUp=last.close>swingHigh,breakoutDown=last.close<swingLow;
 const recent=c.slice(-5);
 const bullishRun=recent.reduce((n,v)=>v.close>v.open?n+1:0,0);
 const bearishRun=recent.reduce((n,v)=>v.close<v.open?n+1:0,0);
 const extensionUp=(last.close-x.e5.at(-1))/Math.max(atr,1e-12);
 const extensionDown=(x.e5.at(-1)-last.close)/Math.max(atr,1e-12);
 // Do not chase a move after four aligned candles or when price is already stretched from EMA5.
 const lateEntryUp=bullishRun>=4||extensionUp>.90;
 const lateEntryDown=bearishRun>=4||extensionDown>.90;
 // Early sequence entry: two or three orderly candles with improving closes, before the move is extended.
 const earlySequenceUp=regime==="UPTREND"&&x.upSequence&&bullish&&last.close>x.e5.at(-1)&&shape.bodyRatio>=.28&&shape.closeLocation>=.62&&!lateEntryUp;
 const earlySequenceDown=regime==="DOWNTREND"&&x.downSequence&&bearish&&last.close<x.e5.at(-1)&&shape.bodyRatio>=.28&&shape.closeLocation<=.38&&!lateEntryDown;
 // Trend-following entries only; late continuation/breakout signals are blocked.
 const pullbackUp=regime==="UPTREND"&&last.low<=x.e5.at(-1)&&last.close>x.e5.at(-1)&&bullish&&!lateEntryUp;
 const pullbackDown=regime==="DOWNTREND"&&last.high>=x.e5.at(-1)&&last.close<x.e5.at(-1)&&bearish&&!lateEntryDown;
 const continuationUp=regime==="UPTREND"&&bullish&&last.close>prev.high&&x.slope5>0&&!lateEntryUp;
 const continuationDown=regime==="DOWNTREND"&&bearish&&last.close<prev.low&&x.slope5<0&&!lateEntryDown;
 const breakoutQualityUp=regime==="UPTREND"&&breakoutUp&&bullish&&shape.closeLocation>.72&&shape.bodyRatio>.35&&!lateEntryUp;
 const breakoutQualityDown=regime==="DOWNTREND"&&breakoutDown&&bearish&&shape.closeLocation<.28&&shape.bodyRatio>.35&&!lateEntryDown;
 const retestUp=c.slice(-4,-1).some(v=>Math.abs(v.low-swingHigh)<atr*.18)&&last.close>swingHigh;
 const retestDown=c.slice(-4,-1).some(v=>Math.abs(v.high-swingLow)<atr*.18)&&last.close<swingLow;
 const candidates=[
  {direction:"CALL",setup:"EARLY_SEQUENCE",evidence:earlySequenceUp?["เริ่มเรียงแท่งขาขึ้น 2–3 แท่ง","EMA5 เริ่มหันขึ้นและราคายังไม่ยืดห่าง"]:[],score:earlySequenceUp?82:0},
  {direction:"PUT",setup:"EARLY_SEQUENCE",evidence:earlySequenceDown?["เริ่มเรียงแท่งขาลง 2–3 แท่ง","EMA5 เริ่มหันลงและราคายังไม่ยืดห่าง"]:[],score:earlySequenceDown?82:0},
  {direction:"CALL",setup:"PULLBACK",evidence:pullbackUp?["แนวโน้มขาขึ้นและราคาย่อตัวกลับเหนือ EMA5"]:[],score:pullbackUp?72:0},
  {direction:"PUT",setup:"PULLBACK",evidence:pullbackDown?["แนวโน้มขาลงและราคาดีดกลับใต้ EMA5"]:[],score:pullbackDown?72:0},
  {direction:"CALL",setup:"CONTINUATION",evidence:continuationUp?["แรงซื้อปิดเหนือ high แท่งก่อน โดยไม่ไล่ราคาที่สุดแล้ว"]:[],score:continuationUp?76:0},
  {direction:"PUT",setup:"CONTINUATION",evidence:continuationDown?["แรงขายปิดใต้ low แท่งก่อน โดยไม่ไล่ราคาที่สุดแล้ว"]:[],score:continuationDown?76:0},
  {direction:"CALL",setup:"BREAKOUT_RETEST",evidence:breakoutQualityUp?["แนวโน้มขาขึ้นปิดทะลุ swing high ด้วยแท่งยืนยัน"]:[],score:breakoutQualityUp?(retestUp?84:70):0},
  {direction:"PUT",setup:"BREAKOUT_RETEST",evidence:breakoutQualityDown?["แนวโน้มขาลงปิดทะลุ swing low ด้วยแท่งยืนยัน"]:[],score:breakoutQualityDown?(retestDown?84:70):0}
 ];
 const trendDirection=regime==="UPTREND"?"CALL":regime==="DOWNTREND"?"PUT":null;
 const best=trendDirection?candidates.filter(v=>v.direction===trendDirection&&v.score>0).sort((a,b)=>b.score-a.score)[0]||null:null;
 const setup=best&&best.score>=70?best:null,warnings=[];
 if(!trendDirection)warnings.push(`TREND ONLY GUARD: ${regime} — งด CALL/PUT จนกว่าแนวโน้มจะชัดเจน`);
 if(x.adx<16)warnings.push("แรงแนวโน้มต่ำ (ADX proxy)");
 if(x.volatilityRatio>1.85)warnings.push("ความผันผวนขยายตัวผิดปกติ");
 if(x.structure.upStructure)warnings.push("โครงสร้าง HH/HL");
 if(x.structure.downStructure)warnings.push("โครงสร้าง LH/LL");
 return{
  ready:true,stage:setup?"TREND_SETUP_CANDIDATE":trendDirection?"WAIT_TREND_ENTRY":"NO_TRADE_GUARD",
  regime,sidewayScore:x.sidewayScore,adxProxy:round(x.adx),atr:round(atr,8),volatilityRatio:round(x.volatilityRatio),
  ema5Slope:round(x.slope5,3),ema20Slope:round(x.slope20,3),
  entryTiming:{bullishRun,bearishRun,extensionUp:round(extensionUp,2),extensionDown:round(extensionDown,2),lateEntryUp,lateEntryDown,earlySequenceUp,earlySequenceDown},
  candle:{bodyRatio:round(shape.bodyRatio,2),upperWick:round(shape.upperWick,2),lowerWick:round(shape.lowerWick,2)},
  structure:{...x.structure,swingHigh,swingLow,breakoutUp,breakoutDown,retestUp,retestDown},
  trendOnly:true,allowedDirection:trendDirection,candidates,
  setup:setup?{direction:setup.direction,type:setup.setup,score:setup.score,evidence:setup.evidence}:null,
  warnings,reason:setup?`TREND ONLY: ${regime} · ${setup.setup} ผ่านเงื่อนไข`:trendDirection&&(trendDirection==="CALL"?lateEntryUp:lateEntryDown)?`งดเข้า ${trendDirection}: ราคาเคลื่อนที่มาไกล/แท่งเรียงตัวต่อเนื่องมากเกินไป — ป้องกันการไล่ปลายรอบ`:trendDirection?`พบ ${regime} แต่ยังไม่มีจังหวะเริ่มต้นที่เหมาะสม`:`งดเทรด: ${regime} ไม่ใช่แนวโน้มขาขึ้นหรือขาลงที่ยืนยันแล้ว`
 };
}
export function analyzeMarketIntelligence(candles){return analyze(candles);}
