const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function getM1CycleWindow(deviceTimeMs) {
  if (!finite(deviceTimeMs)) return { cycleId:null, elapsedMs:null, elapsedSeconds:null, secondsToNextCandle:null, phase:"WAITING", active:false, watch:false };
  const timestamp=Number(deviceTimeMs);
  const elapsedMs=((timestamp%60000)+60000)%60000;
  const elapsedSeconds=Math.floor(elapsedMs/1000);
  const watch=elapsedSeconds>=50&&elapsedSeconds<=54;
  const active=elapsedSeconds>=55&&elapsedSeconds<=59;
  return {
    cycleId:Math.floor(timestamp/60000),
    elapsedMs,
    elapsedSeconds,
    secondsToNextCandle:Math.max(0,Math.ceil((60000-elapsedMs)/1000)),
    phase:watch?"WATCH":active?"ORDER":"WAITING",
    active,
    watch
  };
}

export function calculateEma(values, period) {
  const series=(Array.isArray(values)?values:[]).filter(finite).map(Number);
  if(!series.length)return null;
  const alpha=2/(period+1);
  // Use an SMA seed when enough history exists; otherwise seed from the first APK candle
  // so the EMA20 can begin warming up immediately after a service restart.
  let index=1,ema=series[0];
  if(series.length>=period){
    ema=series.slice(0,period).reduce((sum,value)=>sum+value,0)/period;
    index=period;
  }
  for(let i=index;i<series.length;i++)ema=series[i]*alpha+ema*(1-alpha);
  return ema;
}

export function evaluateOpenBias({open,price,precision=5}) {
  if (!finite(open)||!finite(price)||Number(open)<=0||Number(price)<=0)
    return {direction:"WAIT",delta:null,tickSize:null};
  const digits=clamp(Math.round(Number(precision)||5),1,10);
  const tickSize=10**(-digits);
  const delta=Number(price)-Number(open);
  const direction=Math.abs(delta)<tickSize?"WAIT":delta>0?"CALL":"PUT";
  return {direction,delta,tickSize};
}

export function predictNextCandle({candles,price,priceHistory=[]}) {
  if(!finite(price)||Number(price)<=0)
    return {signal:"WAIT",status:"PRICE_UNREADABLE",reason:"ยังไม่ได้รับราคาตัวเลขจาก APK",source:"APK_CAPTURED_PRICE_OHLC"};
  const series=(Array.isArray(candles)?candles:[]).filter(c=>
    [c.open,c.high,c.low,c.close].every(finite)&&
    Number(c.high)>=Math.max(Number(c.open),Number(c.close))&&
    Number(c.low)<=Math.min(Number(c.open),Number(c.close))&&
    Number(c.high)>=Number(c.low)
  ).slice(-100);
  if(series.length<2)
    return {signal:"WAIT",status:"EMA_HISTORY_INSUFFICIENT",reason:"ต้องมีแท่ง M1 จากราคา APK อย่างน้อย 2 แท่งเพื่อเริ่มคำนวณ EMA5/EMA20",calibratedCandles:series.length,source:"APK_CAPTURED_PRICE_OHLC",ema5:null,ema20:null};

  const closes=series.map(c=>Number(c.close));
  closes[closes.length-1]=Number(price);
  const ema5=calculateEma(closes,5),ema20=calculateEma(closes,20);
  const previousCloses=closes.slice(0,-1);
  const previousEma5=calculateEma(previousCloses,5),previousEma20=calculateEma(previousCloses,20);
  const latest=series.at(-1);
  const prices=(Array.isArray(priceHistory)?priceHistory:[]).filter(v=>finite(v)&&Number(v)>0).slice(-8).map(Number);
  const previousPrice=prices.length>=2?prices.at(-2):null;
  const rising=previousPrice!==null&&Number(price)>previousPrice;
  const falling=previousPrice!==null&&Number(price)<previousPrice;
  const fastAboveSlow=ema5>ema20;
  const fastBelowSlow=ema5<ema20;
  const crossUp=previousEma5!==null&&previousEma20!==null&&previousEma5<=previousEma20&&ema5>ema20;
  const crossDown=previousEma5!==null&&previousEma20!==null&&previousEma5>=previousEma20&&ema5<ema20;
  const bullishPullback=(Number(latest.low)<=Math.max(ema5,ema20))&&Number(price)>ema5&&rising;
  const bearishPullback=(Number(latest.high)>=Math.min(ema5,ema20))&&Number(price)<ema5&&falling;
  const bullishContinuation=fastAboveSlow&&Number(price)>=ema5;
  const bearishContinuation=fastBelowSlow&&Number(price)<=ema5;

  let signal="WAIT",setup="NONE",reason="EMA5 และ EMA20 ยังไม่เข้าเงื่อนไขทิศทางเดียวกัน";
  if((crossUp&&Number(price)>=ema5)||(fastAboveSlow&&(bullishContinuation||bullishPullback))){
    signal="CALL";
    setup=crossUp?"EMA5_CROSS_UP_EMA20":bullishPullback?"EMA_PULLBACK_BOUNCE_UP":"EMA5_ABOVE_EMA20";
    reason=setup==="EMA5_CROSS_UP_EMA20"?"EMA5 ตัดขึ้นเหนือ EMA20 · เตรียม CALL แท่งถัดไป":setup==="EMA_PULLBACK_BOUNCE_UP"?"ราคาย่อลงหา EMA5/EMA20 แล้วดีดกลับขึ้น":"EMA5 อยู่เหนือ EMA20 และราคาอยู่เหนือ EMA5";
  }else if((crossDown&&Number(price)<=ema5)||(fastBelowSlow&&(bearishContinuation||bearishPullback))){
    signal="PUT";
    setup=crossDown?"EMA5_CROSS_DOWN_EMA20":bearishPullback?"EMA_PULLBACK_REJECTION_DOWN":"EMA5_BELOW_EMA20";
    reason=setup==="EMA5_CROSS_DOWN_EMA20"?"EMA5 ตัดลงต่ำกว่า EMA20 · เตรียม PUT แท่งถัดไป":setup==="EMA_PULLBACK_REJECTION_DOWN"?"ราคาดีดหา EMA5/EMA20 แล้วถูกกดกลับลง":"EMA5 อยู่ต่ำกว่า EMA20 และราคาอยู่ใต้ EMA5";
  }else if(fastAboveSlow)reason="แนวโน้ม EMA เป็นขาขึ้น แต่รอราคาอยู่เหนือ EMA5 หรือยืนยันการดีดกลับ";
  else if(fastBelowSlow)reason="แนวโน้ม EMA เป็นขาลง แต่รอราคาอยู่ใต้ EMA5 หรือยืนยันการถูกกดลง";

  const gap=Math.abs(ema5-ema20);
  const confidence=signal==="WAIT"||series.length<20?"LOW":gap/Math.max(Math.abs(ema20),1e-12)>0.00005?"MEDIUM":"LOW";
  return {
    signal,status:signal==="WAIT"?"EMA_NO_ENTRY":"NEXT_CANDLE_PREDICTED",
    target:"NEXT_M1_CANDLE",setup,reason,confidence,calibratedCandles:series.length,
    emaWarmupCandles:Math.max(0,20-series.length),
    ema5:Number(ema5.toFixed(10)),ema20:Number(ema20.toFixed(10)),
    previousEma5:previousEma5===null?null:Number(previousEma5.toFixed(10)),
    previousEma20:previousEma20===null?null:Number(previousEma20.toFixed(10)),
    evidence:{fastAboveSlow,fastBelowSlow,crossUp,crossDown,bullishContinuation,bearishContinuation,bullishPullback,bearishPullback,rising,falling},
    calibration:"APK_PRICE_DERIVED_M1_OHLC_EMA5_EMA20",source:"APK_CAPTURED_PRICE_OHLC"
  };
}
