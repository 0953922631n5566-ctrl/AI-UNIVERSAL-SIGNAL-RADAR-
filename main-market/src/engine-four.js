/** Engine 4: EMA 5/20 trend + the just-closed M1 candle for next-M1 entry. */
export const ENGINE4_EMA_FAST_PERIOD = 5;
export const ENGINE4_EMA_SLOW_PERIOD = 20;
export const ENGINE4_MIN_BODY_PIPS = 0.4;
export const ENGINE4_MIN_SCORE = 40;
export const ENGINE4_HISTORY_CANDLES = ENGINE4_EMA_SLOW_PERIOD;

function validCandle(c) {
  return c && c.live === false && Number.isFinite(c.epoch) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}

function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status,strategy:"EMA5_20_CLOSED_M1_TO_NEXT_M1_ENTRY",reason,...extra};
}

function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length < period ||
      values.some(value => !Number.isFinite(value))) return null;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  return values.slice(period).reduce(
    (ema, value) => value * multiplier + ema * (1 - multiplier), seed
  );
}

/**
 * EMA direction is calculated from completed-candle closes only.
 * The latest completed candle's body and wick structure must confirm that
 * direction. The resulting signal targets exactly the next M1 candle.
 */
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const closed = options.closedCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(closed))
    return notReady("CLOSED_M1_CANDLE_NOT_READY","Engine 4 ต้องใช้ OHLC ของแท่ง M1 ที่ปิดสมบูรณ์แล้วเท่านั้น");

  const history = (Array.isArray(candles) ? candles : [])
    .filter(c => validCandle(c) && c.epoch <= closed.epoch)
    .slice(-ENGINE4_HISTORY_CANDLES);
  if (history.length < ENGINE4_HISTORY_CANDLES ||
      history.at(-1)?.epoch !== closed.epoch ||
      history.some((c,i) => i > 0 && c.epoch - history[i-1].epoch !== 60)) {
    return notReady("EMA_HISTORY_NOT_READY",
      "Engine 4 ต้องมีแท่ง M1 ที่ปิดสมบูรณ์และต่อเนื่องอย่างน้อย 20 แท่งเพื่อคำนวณ EMA 5/20",
      {requiredClosedCandles:ENGINE4_HISTORY_CANDLES,availableClosedCandles:history.length});
  }

  const closes = history.map(c => c.close);
  const ema5 = calculateEma(closes, ENGINE4_EMA_FAST_PERIOD);
  const ema20 = calculateEma(closes, ENGINE4_EMA_SLOW_PERIOD);
  if (!Number.isFinite(ema5) || !Number.isFinite(ema20) || ema5 === ema20)
    return notReady("NO_EMA_DIRECTION","EMA 5 และ EMA 20 ยังไม่แยกทิศทางชัดเจน");

  const emaDirection = ema5 > ema20 ? "CALL" : "PUT";
  const sourceCandleEpoch = closed.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const body = closed.close - closed.open;
  const range = closed.high - closed.low;
  const bodyPips = Math.abs(body) / 0.0001;
  const bodyRangeRatio = range > 0 ? Math.abs(body) / range : 0;
  const closeLocation = range > 0 ? (closed.close - closed.low) / range : 0.5;
  const bodyDirection = body > 0 ? "CALL" : body < 0 ? "PUT" : null;
  const directionalCloseLocation = emaDirection === "CALL" ? closeLocation : 1 - closeLocation;

  const upperWick = Math.max(0, closed.high - Math.max(closed.open, closed.close));
  const lowerWick = Math.max(0, Math.min(closed.open, closed.close) - closed.low);
  const supportingWick = emaDirection === "CALL" ? lowerWick : upperWick;
  const opposingWick = emaDirection === "CALL" ? upperWick : lowerWick;
  const wickBalance = range > 0 ? (supportingWick - opposingWick) / range : 0;
  const wickScore = Math.max(0, Math.min(1, (wickBalance + 1) / 2));

  const emaPoints = 40;
  const bodyPoints = Math.round(Math.max(0, Math.min(1, bodyRangeRatio)) * 25);
  const closePoints = Math.round(Math.max(0, Math.min(1, directionalCloseLocation)) * 20);
  const wickPoints = Math.round(wickScore * 15);
  const score = bodyDirection === emaDirection
    ? Math.min(100, emaPoints + bodyPoints + closePoints + wickPoints) : 0;

  const metrics = {
    sourceCandleEpoch,targetCandleEpoch,closedOpen:closed.open,closedHigh:closed.high,
    closedLow:closed.low,closedClose:closed.close,bodyMovement:body,
    bodyPips:+bodyPips.toFixed(2),bodyRangeRatio:+bodyRangeRatio.toFixed(4),
    closeLocation:+closeLocation.toFixed(4),
    directionalCloseLocation:+directionalCloseLocation.toFixed(4),
    ema5:+ema5.toFixed(6),ema20:+ema20.toFixed(6),
    emaGapPips:+(Math.abs(ema5-ema20)/0.0001).toFixed(2),
    emaDirection,bodyDirection,upperWick:+upperWick.toFixed(6),
    lowerWick:+lowerWick.toFixed(6),wickBalance:+wickBalance.toFixed(4),
    scoreBreakdown:{emaAlignment:emaPoints,bodyStrength:bodyPoints,
      closeLocation:closePoints,wickConfirmation:wickPoints},
    minimumBodyPips:ENGINE4_MIN_BODY_PIPS,minimumScore:ENGINE4_MIN_SCORE,
    emaFastPeriod:ENGINE4_EMA_FAST_PERIOD,emaSlowPeriod:ENGINE4_EMA_SLOW_PERIOD,
    emaHistoryCandles:history.length,phase:"CLOSED_M1_EMA5_20_CONFIRMATION"
  };

  if (bodyDirection !== emaDirection || bodyPips < ENGINE4_MIN_BODY_PIPS ||
      directionalCloseLocation <= 0.5 || score < ENGINE4_MIN_SCORE) {
    const reason = bodyDirection !== emaDirection
      ? "ทิศทาง Body ของแท่งปิดสวน EMA 5/20 · งดสัญญาณ"
      : bodyPips < ENGINE4_MIN_BODY_PIPS
        ? "Body ของแท่งปิดเล็กเกินไป · งดสัญญาณ"
        : "ตำแหน่งปิดแท่งไม่ยืนยันแรงตาม EMA 5/20 · งดสัญญาณ";
    return {...notReady("NO_CLEAR_EMA_CLOSED_M1_SIGNAL",reason,
      {sourceCandleEpoch,targetCandleEpoch,emaDirection}),metrics,score,directionCandidate:emaDirection};
  }

  const side = emaDirection === "CALL"
    ? "EMA 5 อยู่เหนือ EMA 20 และแท่ง M1 ปิดบวกยืนยันแรงซื้อ"
    : "EMA 5 อยู่ต่ำกว่า EMA 20 และแท่ง M1 ปิดลบยืนยันแรงขาย";
  return {
    ready:true,decisionMade:true,signal:emaDirection,candidateSignal:emaDirection,
    score,confidence:score,sourceCandleEpoch,candleEpoch:sourceCandleEpoch,
    targetCandleEpoch,targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),
    strategy:"EMA5_20_CLOSED_M1_TO_NEXT_M1_ENTRY",
    analysisMode:"EMA5_20_CLOSED_M1_CONFIRMATION",
    decisionStrength:score>=80?"STRONG":score>=60?"MODERATE":"EARLY",
    entryPrice:null,entryPriceBasis:"FIRST_FRESH_STREAM_TICK_OF_NEXT_M1",
    status:emaDirection==="CALL"?"NEXT_M1_EMA5_20_CALL":"NEXT_M1_EMA5_20_PUT",
    metrics,evidenceSummary:side+" · EMA 5/20 + Body/Wick จากแท่งปิดล่าสุด",
    alertId:"ENGINE_4:"+targetCandleEpoch+":"+emaDirection+":EMA5_20_CLOSED_M1",
    reason:emaDirection+" · "+side+" · คะแนน "+score+"/100 · สัญญาณสำหรับแท่ง M1 ถัดไป"
  };
}
