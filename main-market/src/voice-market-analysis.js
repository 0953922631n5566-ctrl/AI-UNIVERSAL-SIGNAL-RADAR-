const validCandle = candle => candle &&
  [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
  candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) &&
  candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;

function ema(values, period) {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (const item of values.slice(period)) value = item * alpha + value * (1 - alpha);
  return value;
}
function average(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }
function price(value) { return Number.isFinite(value) ? value.toFixed(5) : "ไม่พร้อม"; }

export function analyzeM1Voice(candles, { now = Date.now(), price: livePrice = null } = {}) {
  const rows = (Array.isArray(candles) ? candles : []).filter(validCandle)
    .sort((a,b)=>(a.epoch||0)-(b.epoch||0)).slice(-60);
  if (rows.length < 20) return {
    ok:false, status:"WAITING_FOR_DATA", message:"ข้อมูลแท่งเทียนยังไม่เพียงพอ ต้องมีอย่างน้อย 20 แท่ง M1 ที่ถูกต้อง"
  };
  const current = rows.at(-1);
  const closes = rows.map(c=>c.close);
  const ema5 = ema(closes,5), ema20 = ema(closes,20);
  const candleRange = current.high-current.low;
  const body = Math.abs(current.close-current.open);
  const upperWick = current.high-Math.max(current.open,current.close);
  const lowerWick = Math.min(current.open,current.close)-current.low;
  const bodyPct = candleRange > 0 ? body/candleRange*100 : 0;
  const upperPct = candleRange > 0 ? upperWick/candleRange*100 : 0;
  const lowerPct = candleRange > 0 ? lowerWick/candleRange*100 : 0;
  const direction = current.close > current.open ? "UP" : current.close < current.open ? "DOWN" : "DOJI";
  const last5 = rows.slice(-5);
  const upCount = last5.filter(c=>c.close>c.open).length;
  const downCount = last5.filter(c=>c.close<c.open).length;
  const last3 = rows.slice(-3);
  const momentum = last3.at(-1).close-last3[0].open;
  const trendGapPct = ema20 ? (ema5-ema20)/ema20*100 : 0;
  const trend = trendGapPct > 0.002 ? "UP" : trendGapPct < -0.002 ? "DOWN" : "SIDEWAY";
  const ranges = rows.slice(-15).map(c=>c.high-c.low);
  const atr = average(ranges);
  const recentHigh = Math.max(...rows.slice(-10).map(c=>c.high));
  const recentLow = Math.min(...rows.slice(-10).map(c=>c.low));
  const live = current.provisional === true || current.live === true;
  let candleText = direction==="UP"?"แท่งล่าสุดเป็นแท่งเขียว":direction==="DOWN"?"แท่งล่าสุดเป็นแท่งแดง":"แท่งล่าสุดเป็นโดจิหรือราคาเปิดปิดใกล้กัน";
  candleText += live ? " และยังอยู่ระหว่างก่อตัว" : " และเป็นแท่งที่ปิดแล้ว";
  let trendText = trend==="UP"?"EMA 5 อยู่เหนือ EMA 20 บ่งชี้แรงโน้มเอียงขาขึ้น":trend==="DOWN"?"EMA 5 อยู่ใต้ EMA 20 บ่งชี้แรงโน้มเอียงขาลง":"EMA 5 และ EMA 20 อยู่ใกล้กัน แนวโน้มยังไม่ชัด";
  let momentumText = upCount>=4?"ห้าแท่งล่าสุดมีแท่งขึ้นอย่างน้อยสี่แท่ง":downCount>=4?"ห้าแท่งล่าสุดมีแท่งลงอย่างน้อยสี่แท่ง": "ห้าแท่งล่าสุดสลับขึ้นลง ยังไม่มีแรงด้านเดียวเด่นชัด";
  let wickText = lowerPct>=45?"มีไส้ล่างยาว อาจมีแรงปฏิเสธราคาต่ำ":upperPct>=45?"มีไส้บนยาว อาจมีแรงปฏิเสธราคาสูง":"ไส้เทียนยังไม่แสดงแรงปฏิเสธด้านใดเด่นชัด";
  let directionView = "SIDEWAY";
  if (trend==="UP" && upCount>=3 && direction!=="DOWN") directionView="UP";
  if (trend==="DOWN" && downCount>=3 && direction!=="UP") directionView="DOWN";
  if (Math.abs(trendGapPct)<0.002 && Math.abs(momentum)/Math.max(atr||0.00001,0.00001)<0.35) directionView="SIDEWAY";
  const directionText = directionView==="UP"?"ภาพรวมเอนเอียงขึ้น":directionView==="DOWN"?"ภาพรวมเอนเอียงลง":"ภาพรวมยังแกว่งตัวหรือยังไม่มีทิศทางที่ชัดเจน";
  const currentPrice = Number.isFinite(livePrice) ? livePrice : current.close;
  const candleTime = Number.isFinite(current.epoch) ? new Date(current.epoch*1000).toISOString() : null;
  const summary = [candleText,trendText,momentumText,wickText,directionText].join(" ");
  return {
    ok:true,status:"READY",symbol:"EUR/USD",interval:"1min",analyzedAt:new Date(now).toISOString(),
    candle:{time:candleTime,open:current.open,high:current.high,low:current.low,close:current.close,
      direction,bodyPercent:Math.round(bodyPct),upperWickPercent:Math.round(upperPct),
      lowerWickPercent:Math.round(lowerPct),provisional:live},
    price:currentPrice,trend:{direction:trend,ema5,ema20,gapPercent:Number(trendGapPct.toFixed(4))},
    momentum:{lastFiveUp:upCount,lastFiveDown:downCount,lastThreeChange:Number(momentum.toFixed(5))},
    levels:{recentResistance:recentHigh,recentSupport:recentLow,averageRange15:atr},
    outlook:directionView,details:{candle:candleText,trend:trendText,momentum:momentumText,
      wick:wickText,structure:"กรอบสูงสุดและต่ำสุดของสิบแท่งล่าสุดใช้เป็นแนวต้านและแนวรับระยะใกล้"},
    source:"Twelve Data M1 OHLC + verified live-price preview",
    disclaimer:"เป็นการอ่านเชิงข้อมูล ไม่ใช่คำแนะนำลงทุนหรือการรับประกันทิศทางราคา"
  };
}
