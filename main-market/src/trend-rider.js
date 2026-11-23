const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/**
 * Engine 3 / Trend Rider.
 * All technical indicator values must be supplied by Twelve Data native endpoints.
 * Only raw OHLC structure and candle body/range are derived locally.
 */
export function analyzeTrendRider(candles, options = {}) {
  const minimum = Number.isInteger(options.minimumCandles) ? options.minimumCandles : 30;
  const validCandles = Array.isArray(candles) && candles.length >= minimum &&
    candles.every(c => c && [c.open,c.high,c.low,c.close].every(Number.isFinite) &&
      c.low > 0 && c.high >= Math.max(c.open,c.close) &&
      c.low <= Math.min(c.open,c.close) && c.high >= c.low);
  if (!validCandles) return {ready:false,signal:null,score:0,status:"NOT_READY",
    reason:"Engine 3 ต้องมีแท่ง M1 OHLC จาก Twelve Data อย่างน้อย 30 แท่ง",
    strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_PULLBACK"};

  const {ema5Values=[],ema20Values=[],atrValues=[]}=options;
  const aligned=(rows,key)=>Array.isArray(rows)&&rows.length>=4&&rows.slice(-4).every((v,i,a)=>
    Number.isFinite(v?.[key])&&Number.isFinite(v?.epoch)&&
    (i===0||v.epoch-a[i-1].epoch===60));
  if(!aligned(ema5Values,"ema")||!aligned(ema20Values,"ema")||!aligned(atrValues,"atr")){
    return {ready:false,signal:null,score:0,status:"TWELVE_DATA_INDICATORS_NOT_READY",
      reason:"รอค่า EMA5, EMA20 และ ATR14 จาก Twelve Data ให้ครบและต่อเนื่อง",
      indicatorStatus:{ema5:aligned(ema5Values,"ema")?"READY":"WAITING",ema20:aligned(ema20Values,"ema")?"READY":"WAITING",atr14:aligned(atrValues,"atr")?"READY":"WAITING"},
      strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_PULLBACK"};
  }
  const last=candles.at(-1),previous=candles.at(-2);
  const fastNow=ema5Values.at(-1).ema,slowNow=ema20Values.at(-1).ema;
  const fastBack=ema5Values.at(-4).ema,slowBack=ema20Values.at(-4).ema;
  const volatility=atrValues.at(-1).atr;
  const sourceEpoch=last.epoch;
  const indicatorEpochs=[ema5Values.at(-1).epoch,ema20Values.at(-1).epoch,atrValues.at(-1).epoch];
  if(!Number.isFinite(volatility)||volatility<=0||indicatorEpochs.some(epoch=>epoch!==sourceEpoch)){
    return {ready:false,signal:null,score:0,status:"TWELVE_DATA_INDICATORS_STALE",
      reason:"ค่า EMA/ATR ไม่ตรงกับแท่ง M1 ปิดล่าสุดจาก Twelve Data",
      indicatorStatus:{ema5:"STALE",ema20:"STALE",atr14:"STALE"},
      strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_PULLBACK"};
  }
  const range=Math.max(last.high-last.low,Number.EPSILON);
  const bodyRatio=Math.abs(last.close-last.open)/range;
  const gapAtr=Math.abs(fastNow-slowNow)/volatility;
  const extensionAtr=Math.abs(last.close-fastNow)/volatility;
  const recent=candles.slice(-8,-1);
  const priorHigh=Math.max(...recent.map(c=>c.high));
  const priorLow=Math.min(...recent.map(c=>c.low));
  const risingStructure=last.close>slowNow&&candles.slice(-5).filter((c,i,rows)=>i>0&&c.low>=rows[i-1].low).length>=2;
  const fallingStructure=last.close<slowNow&&candles.slice(-5).filter((c,i,rows)=>i>0&&c.high<=rows[i-1].high).length>=2;
  const upAligned=fastNow>slowNow&&fastNow>fastBack&&slowNow>=slowBack;
  const downAligned=fastNow<slowNow&&fastNow<fastBack&&slowNow<=slowBack;
  const upPullback=last.low<=fastNow+volatility*.25&&last.close>fastNow&&last.close>=last.open;
  const downPullback=last.high>=fastNow-volatility*.25&&last.close<fastNow&&last.close<=last.open;
  const upBreak=last.close>priorHigh,downBreak=last.close<priorLow;
  const upMomentum=last.close>previous.close&&bodyRatio>=.35;
  const downMomentum=last.close<previous.close&&bodyRatio>=.35;
  const scoreUp=Math.round(30*Number(upAligned)+20*clamp(gapAtr/.55)+20*Number(risingStructure)+15*Number(upPullback||upBreak)+15*Number(upMomentum));
  const scoreDown=Math.round(30*Number(downAligned)+20*clamp(gapAtr/.55)+20*Number(fallingStructure)+15*Number(downPullback||downBreak)+15*Number(downMomentum));
  const sideways=gapAtr<.12,late=extensionAtr>1.5,volatilitySpike=range>volatility*2.8;
  let signal=null,score=Math.max(scoreUp,scoreDown),status="TREND_NOT_CONFIRMED",reason="EMA5/EMA20 และโครงสร้างราคาไม่สอดคล้องพอ";
  if(sideways){status="SIDEWAYS_BLOCK";reason="EMA5/EMA20 พันกัน · งดสัญญาณในตลาดออกข้าง";}
  else if(late){status="LATE_ENTRY_BLOCK";reason="ราคาออกห่าง EMA5 เกิน 1.5 ATR · ไม่ไล่ตามเทรนด์";}
  else if(volatilitySpike){status="VOLATILITY_BLOCK";reason="แท่งล่าสุดกว้างผิดปกติเมื่อเทียบกับ ATR14";}
  else if(scoreUp>=65&&scoreUp-scoreDown>=12&&upAligned&&(risingStructure||upBreak)){signal="CALL";score=scoreUp;status="UPTREND_CONTINUATION";reason="EMA5 เหนือ EMA20 · โครงสร้างขาขึ้น · มีแรงต่อเนื่องหรือย่อแล้วกลับขึ้น";}
  else if(scoreDown>=65&&scoreDown-scoreUp>=12&&downAligned&&(fallingStructure||downBreak)){signal="PUT";score=scoreDown;status="DOWNTREND_CONTINUATION";reason="EMA5 ใต้ EMA20 · โครงสร้างขาลง · มีแรงต่อเนื่องหรือย่อแล้วกลับลง";}
  else if(score>=45){status="TREND_WATCH";reason="เริ่มเห็นแนวโน้ม แต่หลักฐานต่อเนื่องยังไม่ครบ";}
  return {ready:true,signal,direction:signal,score,scoreUp,scoreDown,status,reason,
    strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_PULLBACK",provider:"TWELVE_DATA_NATIVE_INDICATORS",
    regime:upAligned?"UPTREND":downAligned?"DOWNTREND":"UNCLEAR",
    metrics:{ema5:fastNow,ema20:slowNow,atr14:volatility,emaGapAtr:Number(gapAtr.toFixed(3)),
      extensionAtr:Number(extensionAtr.toFixed(3)),bodyRatio:Number(bodyRatio.toFixed(3)),priorHigh,priorLow,
      ema5Source:"Twelve Data /ema time_period=5",ema20Source:"Twelve Data /ema time_period=20",atr14Source:"Twelve Data /atr time_period=14"},
    indicatorStatus:{ema5:"READY",ema20:"READY",atr14:"READY"},
    evidence:[upAligned||downAligned?"EMA5/EMA20 alignment and slope agree":"EMA alignment incomplete",
      risingStructure||fallingStructure?"Recent swing structure supports trend":"Swing structure not confirmed",
      upPullback||downPullback?"Pullback reclaimed EMA5":upBreak||downBreak?"Recent structure breakout":"No clean continuation trigger",
      sideways?"Sideways guard active":late?"Late-extension guard active":"No late-entry guard"]};
}
