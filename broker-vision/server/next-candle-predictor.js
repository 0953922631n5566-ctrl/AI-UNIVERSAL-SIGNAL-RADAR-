export function getM1CycleWindow(deviceTimeMs) {
  if (!finite(deviceTimeMs)) return { cycleId:null, elapsedMs:null, elapsedSeconds:null, secondsToNextCandle:null, phase:"WAITING", active:false };
  const timestamp=Number(deviceTimeMs);
  const elapsedMs=((timestamp%60000)+60000)%60000;
  const elapsedSeconds=Math.floor(elapsedMs/1000);
  const active=elapsedSeconds<=55;
  return {
    cycleId:Math.floor(timestamp/60000),
    elapsedMs,
    elapsedSeconds,
    secondsToNextCandle:Math.max(0,Math.ceil((60000-elapsedMs)/1000)),
    phase:active?"ACTIVE":"CUTOFF",
    active
  };
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

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function predictNextCandle({candles,price,priceHistory=[]}) {
  if(!finite(price)||Number(price)<=0)
    return {signal:"WAIT",status:"PRICE_UNREADABLE",reason:"ยังไม่ได้รับราคาตัวเลขจาก APK",source:"APK_CAPTURED_PRICE_OHLC"};
  const series=(Array.isArray(candles)?candles:[]).filter(c=>
    [c.open,c.high,c.low,c.close].every(finite) &&
    Number(c.high)>=Math.max(Number(c.open),Number(c.close)) &&
    Number(c.low)<=Math.min(Number(c.open),Number(c.close)) &&
    Number(c.high)>Number(c.low)
  ).slice(-100);
  if(series.length<4)
    return {signal:"WAIT",status:"CANDLE_DATA_INSUFFICIENT",reason:"ต้องสะสมแท่ง M1 จากราคาจริงของ APK อย่างน้อย 4 แท่งก่อนวิเคราะห์",calibratedCandles:series.length,source:"APK_CAPTURED_PRICE_OHLC"};

  const recent=series.slice(-6).map(c=>{
    const open=Number(c.open),close=Number(c.close),high=Number(c.high),low=Number(c.low);
    const range=high-low,body=Math.abs(close-open);
    return {open,close,high,low,range,body,direction:close>open?1:close<open?-1:0,
      upperWickRatio:Math.max(0,high-Math.max(open,close))/range,
      lowerWickRatio:Math.max(0,Math.min(open,close)-low)/range,
      bodyRatio:body/range,closeLocation:(close-low)/range};
  });
  const latest=recent.at(-1),previous=recent.at(-2);
  const meanRange=recent.reduce((sum,c)=>sum+c.range,0)/recent.length;
  if(!(meanRange>0)||latest.range<meanRange*.06)
    return {signal:"WAIT",status:"CANDLE_RANGE_TOO_SMALL",reason:"แท่ง M1 ล่าสุดมีช่วงราคาเล็กเกินกว่าจะยืนยันทิศทาง",calibratedCandles:series.length,source:"APK_CAPTURED_PRICE_OHLC"};
  const weights=recent.map((c,i)=>(i+1)*c.direction*c.bodyRatio);
  const weightTotal=recent.reduce((sum,_c,i)=>sum+i+1,0);
  const bodyPressure=weights.reduce((sum,value)=>sum+value,0)/weightTotal;
  const trendPressure=clamp((latest.close-recent[0].close)/(meanRange*Math.max(1,recent.length-1)),-1,1);
  const higherCloses=recent.slice(1).filter((c,i)=>c.close>recent[i].close).length;
  const lowerCloses=recent.slice(1).filter((c,i)=>c.close<recent[i].close).length;
  const structureUp=higherCloses>=Math.ceil((recent.length-1)*.6);
  const structureDown=lowerCloses>=Math.ceil((recent.length-1)*.6);
  const bullishRejection=latest.lowerWickRatio>=.42&&latest.bodyRatio<=.48&&latest.closeLocation>=.52;
  const bearishRejection=latest.upperWickRatio>=.42&&latest.bodyRatio<=.48&&latest.closeLocation<=.48;
  const bullishContinuation=bodyPressure>=.16&&trendPressure>=.10&&structureUp&&latest.closeLocation>=.55;
  const bearishContinuation=bodyPressure<=-.16&&trendPressure<=-.10&&structureDown&&latest.closeLocation<=.45;
  const prices=(Array.isArray(priceHistory)?priceHistory:[]).filter(v=>finite(v)&&Number(v)>0).slice(-8).map(Number);
  const uniquePrices=prices.filter((v,i)=>i===0||v!==prices[i-1]);
  const decimals=Math.max(1,...[price,...prices].map(value=>String(value).split(".")[1]?.length||0));
  const tick=10**(-Math.min(decimals,10));
  const priceDelta=uniquePrices.length>=2?uniquePrices.at(-1)-uniquePrices[0]:0;
  const priceConflictsUp=uniquePrices.length>=2&&priceDelta<=-tick;
  const priceConflictsDown=uniquePrices.length>=2&&priceDelta>=tick;
  let signal="WAIT",setup="NONE",reason="โครงสร้างแท่ง M1 จากราคาจริงยังไม่ผ่านเงื่อนไขยืนยัน";
  const bullSetup=bullishContinuation||bullishRejection&&trendPressure>-.12&&bodyPressure>-.08;
  const bearSetup=bearishContinuation||bearishRejection&&trendPressure<.12&&bodyPressure<.08;
  if(bullSetup&&!bearSetup&&!priceConflictsUp){signal="CALL";setup=bullishContinuation?"TREND_CONTINUATION":"LOWER_WICK_REJECTION";reason=bullishContinuation?"แท่ง M1 ปิดสูงขึ้นต่อเนื่องจากราคา APK และแรงซื้อยืนยัน":"ราคาจริงปฏิเสธไส้ล่างและแรงขายกดราคาปิดไม่ลง";}
  else if(bearSetup&&!bullSetup&&!priceConflictsDown){signal="PUT";setup=bearishContinuation?"TREND_CONTINUATION":"UPPER_WICK_REJECTION";reason=bearishContinuation?"แท่ง M1 ปิดต่ำลงต่อเนื่องจากราคา APK และแรงขายยืนยัน":"ราคาจริงปฏิเสธไส้บนและแรงซื้อดันราคาปิดไม่ขึ้น";}
  else if((bullSetup&&priceConflictsUp)||(bearSetup&&priceConflictsDown))reason="ทิศทางราคาล่าสุดขัดกับโครงสร้างแท่ง M1 จึงงดสัญญาณ";
  else if(bullSetup&&bearSetup)reason="พบเงื่อนไข CALL และ PUT ขัดแย้งกัน";
  else if(latest.bodyRatio<.10)reason="แท่ง M1 ล่าสุดเป็น Doji แรงซื้อและแรงขายยังไม่ชนะกัน";
  else if(previous.direction!==0&&latest.direction!==0&&previous.direction!==latest.direction)reason="แท่ง M1 ล่าสุดสวนทิศทางก่อนหน้า ยังต้องรอการยืนยัน";
  const confidence=signal==="WAIT"?"LOW":
    (setup==="TREND_CONTINUATION"&&Math.abs(bodyPressure)>=.28&&Math.abs(trendPressure)>=.20?"HIGH":"MEDIUM");
  return {signal,status:signal==="WAIT"?"NO_CLEAR_DIRECTION":"NEXT_CANDLE_PREDICTED",
    target:"NEXT_M1_CANDLE",setup,reason,confidence,calibratedCandles:series.length,
    evidence:{bodyPressure:Number(bodyPressure.toFixed(3)),trendPressure:Number(trendPressure.toFixed(3)),
      higherCloses,lowerCloses,structureUp,structureDown,
      upperWickRatio:Number(latest.upperWickRatio.toFixed(3)),lowerWickRatio:Number(latest.lowerWickRatio.toFixed(3)),
      bodyRatio:Number(latest.bodyRatio.toFixed(3)),closeLocation:Number(latest.closeLocation.toFixed(3)),
      bullishRejection,bearishRejection,priceDelta:Number(priceDelta.toFixed(decimals)),priceConflictsUp,priceConflictsDown},
    calibration:"APK_PRICE_DERIVED_M1_OHLC",source:"APK_CAPTURED_PRICE_OHLC"};
}
