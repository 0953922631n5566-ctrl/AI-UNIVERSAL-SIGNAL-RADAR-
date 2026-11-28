const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function calibrateCandles(candles, axisPrices) {
  const axis = (Array.isArray(axisPrices) ? axisPrices : [])
    .filter(point => finite(point?.price) && finite(point?.y))
    .sort((a,b) => Number(a.y)-Number(b.y));
  const axisValid = axis.length >= 2 &&
    Math.abs(Number(axis.at(-1).y)-Number(axis[0].y)) >= 10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price)) > 0;
  const toPrice = y => {
    if (!finite(y)) return null;
    if (!axisValid) return -Number(y);
    const first=axis[0],last=axis.at(-1);
    return Number(first.price)+(Number(y)-Number(first.y))*
      (Number(last.price)-Number(first.price))/(Number(last.y)-Number(first.y));
  };
  return (Array.isArray(candles)?candles:[]).slice(-10).map(c=>{
    const open=toPrice(c.openY),close=toPrice(c.closeY),high=toPrice(c.highY),low=toPrice(c.lowY);
    if (![open,close,high,low].every(Number.isFinite)) return null;
    const top=Math.max(high,low,open,close),bottom=Math.min(high,low,open,close);
    const range=top-bottom;
    if (!(range>0)) return null;
    const upperWick=Math.max(0,top-Math.max(open,close));
    const lowerWick=Math.max(0,Math.min(open,close)-bottom);
    const body=Math.abs(close-open);
    return {open,close,high:top,low:bottom,range,body,
      direction:close>open?1:close<open?-1:0,
      upperWickRatio:upperWick/range,lowerWickRatio:lowerWick/range,
      bodyRatio:body/range,closeLocation:(close-bottom)/range};
  }).filter(Boolean);
}

export function predictNextCandle({candles,axisPrices,price,priceHistory=[]}) {
  if(!finite(price)||Number(price)<=0)
    return {signal:"WAIT",status:"PRICE_UNREADABLE",reason:"ยังไม่ได้รับราคาตัวเลขจาก APK",source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
  const axis = (Array.isArray(axisPrices)?axisPrices:[]).filter(p=>finite(p?.price)&&finite(p?.y)).sort((a,b)=>Number(a.y)-Number(b.y));
  const axisValid = axis.length>=2 && Math.abs(Number(axis.at(-1).y)-Number(axis[0].y))>=10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price))>0;
  const calibrated=calibrateCandles(candles,axisPrices);
  if(calibrated.length<4)
    return {signal:"WAIT",status:"CANDLE_DATA_INSUFFICIENT",reason:"ต้องมีแท่งเทียนจาก APK อย่างน้อย 4 แท่ง",calibratedCandles:calibrated.length,source:"APK_PRICE_AND_CANDLE_GEOMETRY"};

  const recent=calibrated.slice(-6),latest=recent.at(-1),previous=recent.at(-2);
  const meanRange=recent.reduce((sum,c)=>sum+c.range,0)/recent.length;
  if(!(meanRange>0)||latest.range<meanRange*.06)
    return {signal:"WAIT",status:"CANDLE_RANGE_TOO_SMALL",reason:"แท่งล่าสุดมีช่วงราคาเล็กเกินกว่าจะยืนยันทิศทาง",calibratedCandles:calibrated.length,source:"APK_PRICE_AND_CANDLE_GEOMETRY"};

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
  const decimals=String(price).split(".")[1]?.length||4;
  const tick=10**(-Math.min(decimals,10));
  const priceDelta=uniquePrices.length>=2?uniquePrices.at(-1)-uniquePrices[0]:0;
  const priceConfirmsUp=uniquePrices.length>=2&&priceDelta>=tick;
  const priceConfirmsDown=uniquePrices.length>=2&&priceDelta<=-tick;
  const priceConflictsUp=uniquePrices.length>=2&&priceDelta<=-tick;
  const priceConflictsDown=uniquePrices.length>=2&&priceDelta>=tick;

  let signal="WAIT",setup="NONE",reason="โครงสร้างแท่งเทียนยังไม่ผ่านเงื่อนไขยืนยัน";
  const bullSetup=bullishContinuation||bullishRejection&&trendPressure>-.12&&bodyPressure>-.08;
  const bearSetup=bearishContinuation||bearishRejection&&trendPressure<.12&&bodyPressure<.08;
  if(bullSetup&&!bearSetup&&!priceConflictsUp){signal="CALL";setup=bullishContinuation?"TREND_CONTINUATION":"LOWER_WICK_REJECTION";reason=bullishContinuation?"แนวโน้มปิดสูงขึ้นต่อเนื่อง แรงซื้อและตำแหน่งปิดแท่งยืนยัน":"ไส้ล่างถูกปฏิเสธและแรงขายไม่สามารถกดราคาปิดลงได้";}
  else if(bearSetup&&!bullSetup&&!priceConflictsDown){signal="PUT";setup=bearishContinuation?"TREND_CONTINUATION":"UPPER_WICK_REJECTION";reason=bearishContinuation?"แนวโน้มปิดต่ำลงต่อเนื่อง แรงขายและตำแหน่งปิดแท่งยืนยัน":"ไส้บนถูกปฏิเสธและแรงซื้อไม่สามารถดันราคาปิดขึ้นได้";}
  else if((bullSetup&&priceConflictsUp)||(bearSetup&&priceConflictsDown))reason="แรงราคาในภาพล่าสุดขัดกับรูปทรงแท่งเทียน จึงงดสัญญาณ";
  else if(bullSetup&&bearSetup)reason="พบเงื่อนไข CALL และ PUT ขัดแย้งกัน";
  else if(latest.bodyRatio<.10)reason="แท่งล่าสุดเป็น Doji แรงซื้อและแรงขายยังไม่ชนะกัน";
  else if(previous.direction!==0&&latest.direction!==0&&previous.direction!==latest.direction)reason="แท่งล่าสุดสวนทิศทางก่อนหน้า ยังต้องรอการยืนยัน";
  const confidence=signal==="WAIT"?"LOW":
    (setup==="TREND_CONTINUATION"&&Math.abs(bodyPressure)>=.28&&Math.abs(trendPressure)>=.20&&
      (signal==="CALL"?structureUp:structureDown)?"HIGH":"MEDIUM");
  return {signal,status:signal==="WAIT"?"NO_CLEAR_DIRECTION":"NEXT_CANDLE_PREDICTED",
    target:"NEXT_M1_CANDLE",setup,reason,confidence,calibratedCandles:calibrated.length,
    evidence:{bodyPressure:Number(bodyPressure.toFixed(3)),trendPressure:Number(trendPressure.toFixed(3)),
      higherCloses,lowerCloses,structureUp,structureDown,
      upperWickRatio:Number(latest.upperWickRatio.toFixed(3)),lowerWickRatio:Number(latest.lowerWickRatio.toFixed(3)),
      bodyRatio:Number(latest.bodyRatio.toFixed(3)),closeLocation:Number(latest.closeLocation.toFixed(3)),
      bullishRejection,bearishRejection,priceDelta:Number(priceDelta.toFixed(decimals)),priceConfirmsUp,priceConfirmsDown},
    calibration:axisValid?"PRICE_AXIS":"APK_CANDLE_PIXEL_GEOMETRY",source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
}
