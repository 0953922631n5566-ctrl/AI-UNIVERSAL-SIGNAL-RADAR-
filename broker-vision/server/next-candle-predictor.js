const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function calibrateCandles(candles, axisPrices) {
  const axis = (Array.isArray(axisPrices) ? axisPrices : [])
    .filter(point => finite(point?.price) && finite(point?.y))
    .sort((a,b) => Number(a.y)-Number(b.y));
  const axisValid = axis.length >= 2 &&
    Math.abs(Number(axis.at(-1).y)-Number(axis[0].y)) >= 10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price)) > 0;
  // Candle direction and wick proportions can be measured in pixel space.
  // If OCR found only one/no axis label, use inverted screen Y as a relative price scale.
  const toPrice = y => {
    if (!finite(y)) return null;
    if (!axisValid) return -Number(y);
    const first=axis[0],last=axis.at(-1);
    return Number(first.price)+(Number(y)-Number(first.y))*
      (Number(last.price)-Number(first.price))/(Number(last.y)-Number(first.y));
  };
  return (Array.isArray(candles)?candles:[]).slice(-12).map(c=>{
    const open=toPrice(c.openY),close=toPrice(c.closeY),high=toPrice(c.highY),low=toPrice(c.lowY);
    if (![open,close,high,low].every(Number.isFinite)) return null;
    const top=Math.max(high,low,open,close),bottom=Math.min(high,low,open,close);
    const range=top-bottom;
    if (!(range>0)) return null;
    const upperWick=Math.max(0,top-Math.max(open,close));
    const lowerWick=Math.max(0,Math.min(open,close)-bottom);
    return {open,close,high:top,low:bottom,range,body:Math.abs(close-open),
      direction:close>open?1:close<open?-1:0,upperWickRatio:upperWick/range,
      lowerWickRatio:lowerWick/range,bodyRatio:Math.abs(close-open)/range};
  }).filter(Boolean);
}

export function predictNextCandle({candles,axisPrices,price}) {
  if(!finite(price)||Number(price)<=0)
    return {signal:"WAIT",status:"PRICE_UNREADABLE",reason:"ยังไม่ได้รับราคาตัวเลขจาก APK",source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
  const axis = (Array.isArray(axisPrices)?axisPrices:[]).filter(p=>finite(p?.price)&&finite(p?.y)).sort((a,b)=>Number(a.y)-Number(b.y));
  const axisValid = axis.length>=2 && Math.abs(Number(axis.at(-1).y)-Number(axis[0].y))>=10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price))>0;
  const calibrated=calibrateCandles(candles,axisPrices);
  if(calibrated.length<4)
    return {signal:"WAIT",status:"CANDLE_DATA_INSUFFICIENT",reason:"ต้องมีแท่งเทียนจาก APK อย่างน้อย 4 แท่ง",calibratedCandles:calibrated.length,source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
  const recent=calibrated.slice(-5),latest=recent.at(-1);
  const meanRange=recent.reduce((s,c)=>s+c.range,0)/recent.length;
  if(!(meanRange>0)||latest.range<meanRange*.08)
    return {signal:"WAIT",status:"CANDLE_RANGE_TOO_SMALL",reason:"ช่วงแกว่งของแท่งล่าสุดเล็กเกินไป",calibratedCandles:calibrated.length,source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
  const weights=recent.map((c,i)=>c.direction*Math.min(c.bodyRatio,1)*(i+1));
  const bodyPressure=weights.reduce((s,v)=>s+v,0)/recent.reduce((s,c,i)=>s+i+1,0);
  const trendPressure=Math.max(-1,Math.min(1,(latest.close-recent[0].close)/(meanRange*recent.length)));
  const rejectionPressure=latest.lowerWickRatio-latest.upperWickRatio;
  const closeLocation=((latest.close-latest.low)/latest.range)*2-1;
  const latestBody=latest.direction*latest.bodyRatio;
  const evidence=bodyPressure*.38+trendPressure*.28+rejectionPressure*.18+closeLocation*.10+latestBody*.06;
  const doji=latest.bodyRatio<.10;
  const opposing=recent.at(-2).direction!==0&&latest.direction!==0&&recent.at(-2).direction!==latest.direction;
  const strongRejection=Math.max(latest.upperWickRatio,latest.lowerWickRatio)>=.58&&latest.bodyRatio<=.30;
  const context=Math.abs(bodyPressure)>=.10||Math.abs(trendPressure)>=.10||strongRejection;
  const threshold=doji ? 0.16 : 0.12;
  const signal=context&&evidence>=threshold?"CALL":context&&evidence<=-threshold?"PUT":"WAIT";
  const reason=signal==="WAIT"?(doji?"แท่งล่าสุดลังเล ยังไม่มีทิศทางชัดเจน":"รูปทรงและแรงส่งยังไม่สอดคล้องกันพอ")
    :signal==="CALL"?"โครงสร้างแท่งเทียนและแรงซื้อสนับสนุนการขึ้นของแท่งถัดไป"
    :"โครงสร้างแท่งเทียนและแรงขายสนับสนุนการลงของแท่งถัดไป";
  return {signal,status:signal==="WAIT"?"NO_CLEAR_DIRECTION":"NEXT_CANDLE_PREDICTED",
    target:"NEXT_M1_CANDLE",reason,confidence:signal==="WAIT"?"LOW":Math.abs(evidence)>=.34&&!opposing?"HIGH":"MEDIUM",
    calibratedCandles:calibrated.length,evidence:{bodyPressure:Number(bodyPressure.toFixed(3)),
      trendPressure:Number(trendPressure.toFixed(3)),upperWickRatio:Number(latest.upperWickRatio.toFixed(3)),
      lowerWickRatio:Number(latest.lowerWickRatio.toFixed(3)),doji,opposingLastTwoCandles:opposing},
    calibration:axisValid?"PRICE_AXIS":"APK_CANDLE_PIXEL_GEOMETRY",source:"APK_PRICE_AND_CANDLE_GEOMETRY"};
}
