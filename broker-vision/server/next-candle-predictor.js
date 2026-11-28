const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function getM1CycleWindow(deviceTimeMs) {
  if (!finite(deviceTimeMs)) return { cycleId:null, elapsedMs:null, elapsedSeconds:null, secondsToNextCandle:null, phase:"WAITING", active:false, watch:false };
  const timestamp=Number(deviceTimeMs);
  const elapsedMs=((timestamp%60000)+60000)%60000;
  const elapsedSeconds=Math.floor(elapsedMs/1000);
  return {
    cycleId:Math.floor(timestamp/60000),
    elapsedMs,
    elapsedSeconds,
    secondsToNextCandle:Math.max(0,Math.ceil((60000-elapsedMs)/1000)),
    phase:"LIVE",
    active:true,
    watch:false
  };
}

export function calculateEma(values, period=5) {
  const series=(Array.isArray(values)?values:[]).filter(finite).map(Number);
  if(!Number.isInteger(period)||period<1||series.length<period)return null;
  const alpha=2/(period+1);
  let ema=series.slice(0,period).reduce((sum,value)=>sum+value,0)/period;
  for(let i=period;i<series.length;i++)ema=series[i]*alpha+ema*(1-alpha);
  return ema;
}

/** Direct EMA5-only rule: live APK price above EMA5 = CALL; below EMA5 = PUT. */
export function predictNextCandle({candles,price}) {
  if(!finite(price)||Number(price)<=0)
    return {signal:"WAIT",status:"PRICE_UNREADABLE",reason:"ยังไม่ได้รับราคาตัวเลขจาก APK",source:"APK_CAPTURED_PRICE_OHLC"};
  const series=(Array.isArray(candles)?candles:[]).filter(c=>
    c&&[c.open,c.high,c.low,c.close].every(finite)&&
    Number(c.high)>=Math.max(Number(c.open),Number(c.close))&&
    Number(c.low)<=Math.min(Number(c.open),Number(c.close))&&
    Number(c.high)>=Number(c.low)
  ).slice(-100);
  if(series.length<5)
    return {signal:"WAIT",status:"EMA5_HISTORY_INSUFFICIENT",reason:`ต้องมีแท่ง M1 จากราคา APK อย่างน้อย 5 แท่งเพื่อคำนวณ EMA5 (มี ${series.length}/5)`,calibratedCandles:series.length,ema5:null,source:"APK_CAPTURED_PRICE_OHLC"};
  const closes=series.map(c=>Number(c.close));
  closes[closes.length-1]=Number(price);
  const ema5=calculateEma(closes,5);
  if(!finite(ema5))
    return {signal:"WAIT",status:"EMA5_CALCULATION_FAILED",reason:"คำนวณ EMA5 ไม่สำเร็จ",calibratedCandles:series.length,ema5:null,source:"APK_CAPTURED_PRICE_OHLC"};
  const currentPrice=Number(price);
  const distance=currentPrice-ema5;
  const signal=distance>0?"CALL":distance<0?"PUT":"WAIT";
  const setup=signal==="CALL"?"PRICE_ABOVE_EMA5":signal==="PUT"?"PRICE_BELOW_EMA5":"PRICE_ON_EMA5";
  const reason=signal==="CALL"?"ราคาปัจจุบันอยู่เหนือ EMA5 · ส่งสัญญาณ CALL สำหรับแท่ง M1 ถัดไป"
    :signal==="PUT"?"ราคาปัจจุบันอยู่ต่ำกว่า EMA5 · ส่งสัญญาณ PUT สำหรับแท่ง M1 ถัดไป"
    :"ราคาปัจจุบันเท่ากับ EMA5 · ยังไม่มีทิศทาง";
  return {
    signal,status:signal==="WAIT"?"PRICE_ON_EMA5":"NEXT_CANDLE_PREDICTED",
    target:"NEXT_M1_CANDLE",setup,reason,calibratedCandles:series.length,
    ema5:Number(ema5.toFixed(10)),price:currentPrice,
    distanceFromEma5:Number(distance.toFixed(10)),
    evidence:{priceAboveEma5:distance>0,priceBelowEma5:distance<0,priceOnEma5:distance===0},
    calibration:"APK_PRICE_DERIVED_M1_OHLC_EMA5_ONLY",source:"APK_CAPTURED_PRICE_OHLC"
  };
}

export function evaluateOpenBias({open,price,precision=5}) {
  if (!finite(open)||!finite(price)||Number(open)<=0||Number(price)<=0)
    return {direction:"WAIT",delta:null,tickSize:null};
  const digits=Math.max(1,Math.min(10,Math.round(Number(precision)||5)));
  const tickSize=10**(-digits);
  const delta=Number(price)-Number(open);
  const direction=Math.abs(delta)<tickSize?"WAIT":delta>0?"CALL":"PUT";
  return {direction,delta,tickSize};
}
