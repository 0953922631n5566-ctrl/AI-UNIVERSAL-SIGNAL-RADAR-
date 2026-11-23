/**
 * Engine 4: Twelve Data adaptive M1 scalper. Uses provider EMA5, M1 OHLC and live ticks.
 * RSI/MACD/ADX/ATR/Bollinger are derived locally from the same OHLC to conserve REST credits.
 */
export const ENGINE4_STRATEGY = "TWELVE_DATA_ADAPTIVE_M1_MOMENTUM_PULLBACK_RANGE";
const MAX_TICK_AGE_MS=5000, MAX_EMA_AGE_MS=120000, MIN_CLOSED_CANDLES=30;
function notReady(status,reason,nextState=null,metrics=null){return{ready:false,decisionMade:false,signal:null,candidateSignal:null,status,strategy:ENGINE4_STRATEGY,reason,nextState,metrics};}
function validEmaPoint(p){return p&&Number.isFinite(p.epoch)&&Number.isFinite(p.ema)&&p.ema>0;}
function emaSeries(values,period){if(!values.length)return[];const a=2/(period+1);let v=values[0];return values.map((x,i)=>{if(i)v=x*a+v*(1-a);return v;});}
function avg(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function rsiValue(xs,n=7){const ds=[];for(let i=Math.max(1,xs.length-n);i<xs.length;i++)ds.push(xs[i]-xs[i-1]);const g=avg(ds.map(x=>Math.max(0,x))),l=avg(ds.map(x=>Math.max(0,-x)));if(!g&&!l)return 50;if(!l)return 100;if(!g)return 0;return 100-100/(1+g/l);}
function macdHist(xs){const f=emaSeries(xs,5),s=emaSeries(xs,13),line=f.map((v,i)=>v-s[i]),sig=emaSeries(line,4);return line.map((v,i)=>v-sig[i]);}
function marketMetrics(cs){const tr=[],pdm=[],mdm=[];for(let i=0;i<cs.length;i++){const c=cs[i],p=cs[i-1];tr.push(p?Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)):c.high-c.low);if(!p){pdm.push(0);mdm.push(0);continue;}const up=c.high-p.high,down=p.low-c.low;pdm.push(up>down&&up>0?up:0);mdm.push(down>up&&down>0?down:0);}const n=14,atr=avg(tr.slice(-n)),dx=[];for(let i=n;i<tr.length;i++){const t=avg(tr.slice(i-n+1,i+1)),p=avg(pdm.slice(i-n+1,i+1)),m=avg(mdm.slice(i-n+1,i+1)),pdi=t?100*p/t:0,mdi=t?100*m/t:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0);}const adx=avg(dx.slice(-n)),cl=cs.map(c=>c.close).slice(-20),mid=avg(cl),sd=Math.sqrt(avg(cl.map(x=>(x-mid)**2)));return{atr,adx,bbUpper:mid+2*sd,bbMiddle:mid,bbLower:mid-2*sd};}
export function analyzeEarlyEntryEngine4({emaValues,candles,livePrice,tickAt,now=Date.now(),symbol="EUR/USD",sourceCandleEpoch=Math.floor(now/60000)*60,state=null}={}){
 if(!Array.isArray(emaValues)||emaValues.length<2||!emaValues.slice(-2).every(validEmaPoint)||emaValues.at(-1).epoch-emaValues.at(-2).epoch!==60)return notReady("TWELVE_DATA_EMA_NOT_READY","รอ EMA 5 สองแท่ง M1 ที่ปิดแล้วจาก Twelve Data");
 const [prevEma,lastEma]=emaValues.slice(-2),emaAge=now-(lastEma.epoch+60)*1000;
 if(!Number.isFinite(emaAge)||emaAge< -5000||emaAge>MAX_EMA_AGE_MS)return notReady("TWELVE_DATA_EMA_STALE","ค่า EMA 5 จาก Twelve Data เก่าเกินกำหนด");
 if(!Number.isFinite(livePrice)||livePrice<=0||!Number.isFinite(tickAt)||tickAt>now||now-tickAt>MAX_TICK_AGE_MS)return notReady("LIVE_PRICE_STALE","รอราคา Twelve Data Streaming สด");
 if(!Number.isFinite(sourceCandleEpoch)||!Array.isArray(candles))return notReady("M1_OHLC_NOT_READY","รอข้อมูลแท่ง M1 จาก Twelve Data");
 const closed=candles.filter(c=>c&&!c.live&&Number.isFinite(c.epoch)&&[c.open,c.high,c.low,c.close].every(Number.isFinite)).slice(-60),live=candles.at(-1);
 if(closed.length<MIN_CLOSED_CANDLES||!live?.live||live.epoch!==sourceCandleEpoch||![live.open,live.high,live.low,live.close].every(Number.isFinite))return notReady("M1_OHLC_HISTORY_NOT_READY","ต้องมีแท่ง M1 ปิดอย่างน้อย 30 แท่งและแท่งปัจจุบัน");
 if(state?.triggeredCandleEpoch===sourceCandleEpoch)return notReady("ENGINE4_ALREADY_TRIGGERED_THIS_CANDLE","Engine 4 ส่งสัญญาณแล้วในแท่ง M1 นี้ · รอแท่งถัดไป",state);
 const closes=closed.map(c=>c.close),e8=emaSeries(closes,8),e21=emaSeries(closes,21),fast=e8.at(-1),slow=e21.at(-1),hist=macdHist(closes),macd=hist.at(-1),rsi=rsiValue(closes),v=marketMetrics(closed),atr=v.atr;
 if(!(atr>0)||!Number.isFinite(v.adx))return notReady("VOLATILITY_NOT_READY","ข้อมูล ATR/ADX ยังไม่เพียงพอ");
 const range=live.high-live.low;if(range>atr*2.8)return notReady("ABNORMAL_M1_VOLATILITY","แท่งปัจจุบันผันผวนผิดปกติ · พักการเข้าออเดอร์",state,{atr14:atr,currentRange:range,rangeLimit:atr*2.8});
 const slope=lastEma.ema-prevEma.ema,bull=fast>slow&&slope>0,bear=fast<slow&&slope<0,trend=v.adx>=14&&Math.abs(fast-slow)>=atr*.05,prev=closed.at(-1);
 const callMomentum=macd>=-atr*.015&&rsi>=48&&rsi<=78,putMomentum=macd<=atr*.015&&rsi<=52&&rsi>=22;
 const callPull=live.low<=fast+atr*.30&&livePrice>fast+atr*.02&&live.close>=live.open,putPull=live.high>=fast-atr*.30&&livePrice<fast-atr*.02&&live.close<=live.open;
 const callBreak=livePrice>prev.high+atr*.025&&live.close>live.open,putBreak=livePrice<prev.low-atr*.025&&live.close<live.open;
 const width=v.bbUpper-v.bbLower,bbp=width>0?(livePrice-v.bbLower)/width:.5;
 const rangeCall=v.adx<14&&bbp<=.14&&rsi<=42&&live.low<=v.bbLower+atr*.12&&livePrice>v.bbLower+atr*.025&&live.close>live.open;
 const rangePut=v.adx<14&&bbp>=.86&&rsi>=58&&live.high>=v.bbUpper-atr*.12&&livePrice<v.bbUpper-atr*.025&&live.close<live.open;
 let signal=null,trigger=null;const regime=trend?"TREND":v.adx<14?"RANGE":"TRANSITION";
 if(trend&&bull&&callMomentum&&(callPull||callBreak)){signal="CALL";trigger=callPull?"TREND_PULLBACK_RECLAIM":"MOMENTUM_BREAKOUT";}
 else if(trend&&bear&&putMomentum&&(putPull||putBreak)){signal="PUT";trigger=putPull?"TREND_PULLBACK_REJECTION":"MOMENTUM_BREAKDOWN";}
 else if(rangeCall){signal="CALL";trigger="RANGE_LOWER_BAND_REJECTION";}
 else if(rangePut){signal="PUT";trigger="RANGE_UPPER_BAND_REJECTION";}
 const metrics={regime,ema5:lastEma.ema,ema5Slope:slope,ema8:fast,ema21:slow,rsi7:+rsi.toFixed(2),macdHistogram:macd,previousMacdHistogram:hist.at(-2),adx14:+v.adx.toFixed(2),atr14:atr,bbPercent:+bbp.toFixed(3),livePrice,trigger,dataSource:"TWELVE_DATA_M1_OHLC_PLUS_EMA5_PLUS_STREAMING"};
 if(!signal)return notReady("ENGINE4_WAITING_FOR_SETUP",regime==="TRANSITION"?"ตลาดกำลังเปลี่ยนโหมด · รอจังหวะชัดเจน":regime==="TREND"?"รอจังหวะย่อกลับ EMA 8 หรือทะลุกรอบพร้อม MACD/RSI ไปทางเดียวกัน":"ตลาด Sideway · รอราคาปฏิเสธขอบ Bollinger พร้อม RSI ยืนยัน",state,metrics);
 const nextState={...(state||{}),triggeredCandleEpoch:sourceCandleEpoch,direction:signal,trigger},reason=signal==="CALL"?(regime==="TREND"?"แนวโน้มขึ้น + MACD/RSI สนับสนุน + ย่อแล้วคืน EMA 8/เบรกขึ้น · CALL":"Sideway แตะขอบล่าง Bollinger + RSI อ่อนแรงแล้วเด้ง · CALL"):(regime==="TREND"?"แนวโน้มลง + MACD/RSI สนับสนุน + ดีดแล้วหลุด EMA 8/เบรกลง · PUT":"Sideway แตะขอบบน Bollinger + RSI อ่อนแรงแล้วกลับลง · PUT");
 return{ready:true,decisionMade:true,signal,candidateSignal:signal,sourceCandleEpoch,candleEpoch:sourceCandleEpoch,targetCandleEpoch:sourceCandleEpoch,targetCandleAt:new Date(sourceCandleEpoch*1000).toISOString(),entryPrice:livePrice,entryPriceBasis:"TWELVE_DATA_LIVE_STREAM_TRIGGER_PRICE",strategy:ENGINE4_STRATEGY,analysisMode:ENGINE4_STRATEGY,status:signal==="CALL"?"ADAPTIVE_MOMENTUM_CALL":"ADAPTIVE_MOMENTUM_PUT",trigger,metrics,nextState,evidenceSummary:reason,alertId:"ENGINE_4:"+sourceCandleEpoch+":"+signal+":"+trigger,reason};
}
