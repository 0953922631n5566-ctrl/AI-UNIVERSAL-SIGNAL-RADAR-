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
  const indicatorEpoch=indicatorEpochs[0];
  const indicatorLagSeconds=sourceEpoch-indicatorEpoch;
  const indicatorLagCandles=indicatorLagSeconds/60;
  // Twelve Data native indicator endpoints can publish the latest completed M1 value one candle late.
  // Permit exactly one completed-candle lag; never analyze with indicators that are ahead or >=2 candles stale.
  if(!Number.isFinite(volatility)||volatility<=0||indicatorEpochs.some(epoch=>epoch!==indicatorEpoch)||
    indicatorLagSeconds<0||!Number.isInteger(indicatorLagCandles)||indicatorLagCandles>1){
    return {ready:false,signal:null,score:0,status:"TWELVE_DATA_INDICATORS_STALE",
      reason:"ค่า EMA/ATR จาก Twelve Data ล่าช้ากว่าแท่ง M1 ล่าสุดเกิน 1 แท่งหรือเวลาไม่ตรงกัน",
      indicatorStatus:{ema5:"STALE",ema20:"STALE",atr14:"STALE"},
      metrics:{indicatorEpoch,sourceCandleEpoch:sourceEpoch,indicatorLagCandles:Number.isFinite(indicatorLagCandles)?indicatorLagCandles:null},
      strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_CONTINUATION"};
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
  // In a clearly aligned trend, a strong candle continuing beyond EMA5 is a valid trigger
  // even when the latest swing has not yet printed a fresh higher-low/lower-high or breakout.
  const upContinuation=upAligned&&last.close>fastNow&&upMomentum;
  const downContinuation=downAligned&&last.close<fastNow&&downMomentum;
  const scoreUp=Math.round(30*Number(upAligned)+20*clamp(gapAtr/.55)+20*Number(risingStructure)+15*Number(upPullback||upBreak)+15*Number(upMomentum));
  const scoreDown=Math.round(30*Number(downAligned)+20*clamp(gapAtr/.55)+20*Number(fallingStructure)+15*Number(downPullback||downBreak)+15*Number(downMomentum));
  const sideways=gapAtr<.08,late=extensionAtr>1.5,volatilitySpike=range>volatility*2.8;
  let signal=null,score=Math.max(scoreUp,scoreDown),status="TREND_NOT_CONFIRMED",reason="EMA5/EMA20 และแรงส่งยังไม่ยืนยันไปทางเดียวกัน";
  if(sideways){status="SIDEWAYS_BLOCK";reason="EMA5/EMA20 พันกัน · งดสัญญาณในตลาดออกข้าง";}
  else if(late){status="LATE_ENTRY_BLOCK";reason="ราคาออกห่าง EMA5 เกิน 1.5 ATR · ไม่ไล่ตามเทรนด์";}
  else if(volatilitySpike){status="VOLATILITY_BLOCK";reason="แท่งล่าสุดกว้างผิดปกติเมื่อเทียบกับ ATR14";}
  else if(scoreUp>=58&&scoreUp-scoreDown>=8&&upAligned&&(risingStructure||upBreak||upContinuation)){signal="CALL";score=scoreUp;status=upContinuation&&!risingStructure&&!upBreak?"UPTREND_MOMENTUM_CONTINUATION":"UPTREND_CONTINUATION";reason=upContinuation&&!risingStructure&&!upBreak?"EMA5 เหนือ EMA20 และแท่งล่าสุดยืนยันแรงซื้อเหนือ EMA5":"EMA5 เหนือ EMA20 · โครงสร้างหรือแรงต่อเนื่องยืนยันขาขึ้น";}
  else if(scoreDown>=58&&scoreDown-scoreUp>=8&&downAligned&&(fallingStructure||downBreak||downContinuation)){signal="PUT";score=scoreDown;status=downContinuation&&!fallingStructure&&!downBreak?"DOWNTREND_MOMENTUM_CONTINUATION":"DOWNTREND_CONTINUATION";reason=downContinuation&&!fallingStructure&&!downBreak?"EMA5 ใต้ EMA20 และแท่งล่าสุดยืนยันแรงขายใต้ EMA5":"EMA5 ใต้ EMA20 · โครงสร้างหรือแรงต่อเนื่องยืนยันขาลง";}
  else if(score>=45){status="TREND_WATCH";reason="เริ่มเห็นแนวโน้ม แต่คะแนนหรือแรงยืนยันยังไม่ครบ";}
  const blockers=[];
  if(sideways)blockers.push("SIDEWAYS");
  if(late)blockers.push("LATE_ENTRY");
  if(volatilitySpike)blockers.push("ABNORMAL_RANGE");
  if(!upAligned&&!downAligned)blockers.push("EMA_ALIGNMENT");
  if(upAligned&&!risingStructure&&!upBreak&&!upContinuation)blockers.push("CALL_TRIGGER");
  if(downAligned&&!fallingStructure&&!downBreak&&!downContinuation)blockers.push("PUT_TRIGGER");
  if(Math.max(scoreUp,scoreDown)<58)blockers.push("SCORE_BELOW_58");
  if(Math.abs(scoreUp-scoreDown)<8)blockers.push("SCORE_LEAD_BELOW_8");
  return {ready:true,signal,direction:signal,score,scoreUp,scoreDown,status,reason,blockers,
    strategy:"TWELVE_DATA_EMA5_EMA20_ATR14_STRUCTURE_CONTINUATION",provider:"TWELVE_DATA_NATIVE_INDICATORS",
    regime:upAligned?"UPTREND":downAligned?"DOWNTREND":"UNCLEAR",
    metrics:{ema5:fastNow,ema20:slowNow,atr14:volatility,emaGapAtr:Number(gapAtr.toFixed(3)),
      extensionAtr:Number(extensionAtr.toFixed(3)),bodyRatio:Number(bodyRatio.toFixed(3)),priorHigh,priorLow,
      indicatorEpoch,sourceCandleEpoch:sourceEpoch,indicatorLagCandles,
      upAligned,downAligned,risingStructure,fallingStructure,upBreak,downBreak,
      upPullback,downPullback,upMomentum,downMomentum,upContinuation,downContinuation,
      ema5Source:"Twelve Data /ema time_period=5",ema20Source:"Twelve Data /ema time_period=20",atr14Source:"Twelve Data /atr time_period=14"},
    indicatorStatus:{ema5:"READY",ema20:"READY",atr14:"READY"},
    evidence:[upAligned||downAligned?"EMA5/EMA20 alignment and slope agree":"EMA alignment incomplete",
      risingStructure||fallingStructure?"Recent swing structure supports trend":"Swing structure not confirmed",
      upPullback||downPullback?"Pullback reclaimed EMA5":upBreak||downBreak?"Recent structure breakout":upContinuation||downContinuation?"Trend continuation momentum confirmed":"No clean continuation trigger",
      sideways?"Sideways guard active":late?"Late-extension guard active":"No late-entry guard"]};
}
