/** Engine 4: analyze the just-closed M1 candle and signal for the immediately following M1 open. */
export const ENGINE4_MIN_BODY_PIPS = 0.4;
export const ENGINE4_MIN_BODY_RANGE_RATIO = 0.55;
export const ENGINE4_MIN_CLOSE_LOCATION = 0.72;
export const ENGINE4_MIN_SCORE = 65;

function validCandle(c) {
  return c && c.live === false && Number.isFinite(c.epoch) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.low > 0 &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && c.high >= c.low;
}
function notReady(status,reason,extra={}) {
  return {ready:false,decisionMade:false,signal:null,candidateSignal:null,score:0,confidence:0,
    status,strategy:"CLOSED_M1_TO_NEXT_M1_ENTRY",reason,...extra};
}

/**
 * Direction is derived exclusively from one fully-closed M1 candle's OHLC.
 * The target is the immediately following M1 candle. No live-candle preview,
 * tick-direction inference, or multi-candle accumulation is used.
 */
export function analyzeEarlyEntryEngine4(candles,options={}) {
  const closed = options.closedCandle || (Array.isArray(candles) ? candles.at(-1) : null);
  if (!validCandle(closed))
    return notReady("CLOSED_M1_CANDLE_NOT_READY","Engine 4 ต้องใช้ OHLC ของแท่ง M1 ที่ปิดสมบูรณ์แล้วเท่านั้น");
  const sourceCandleEpoch = closed.epoch;
  const targetCandleEpoch = sourceCandleEpoch + 60;
  const body = closed.close - closed.open;
  const range = closed.high - closed.low;
  const bodyPips = Math.abs(body) / 0.0001;
  const bodyRangeRatio = range > 0 ? Math.abs(body) / range : 0;
  const closeLocation = range > 0 ? (closed.close - closed.low) / range : 0.5;
  const direction = body > 0 ? "CALL" : body < 0 ? "PUT" : null;
  const directionalCloseLocation = direction === "CALL" ? closeLocation
    : direction === "PUT" ? 1 - closeLocation : 0;
  const score = direction
    ? Math.round((bodyRangeRatio * 0.55 + directionalCloseLocation * 0.45) * 100) : 0;
  const metrics = {
    sourceCandleEpoch,targetCandleEpoch,closedOpen:closed.open,closedHigh:closed.high,
    closedLow:closed.low,closedClose:closed.close,bodyMovement:body,
    bodyPips:+bodyPips.toFixed(2),rangeMovement:range,
    bodyRangeRatio:+bodyRangeRatio.toFixed(4),closeLocation:+closeLocation.toFixed(4),
    directionalCloseLocation:+directionalCloseLocation.toFixed(4),
    minimumBodyPips:ENGINE4_MIN_BODY_PIPS,minimumBodyRangeRatio:ENGINE4_MIN_BODY_RANGE_RATIO,
    minimumDirectionalCloseLocation:ENGINE4_MIN_CLOSE_LOCATION,minimumScore:ENGINE4_MIN_SCORE,
    phase:"CLOSED_M1_CONFIRMATION"
  };
  if (!direction || bodyPips < ENGINE4_MIN_BODY_PIPS ||
      bodyRangeRatio < ENGINE4_MIN_BODY_RANGE_RATIO ||
      directionalCloseLocation < ENGINE4_MIN_CLOSE_LOCATION || score < ENGINE4_MIN_SCORE) {
    return {...notReady("NO_CLEAR_CLOSED_M1_SIGNAL",
      "แท่ง M1 ที่ปิดล่าสุดยังไม่ผ่านเกณฑ์ Body และตำแหน่งปิด · งดสัญญาณ",
      {sourceCandleEpoch,targetCandleEpoch}),metrics,score,directionCandidate:direction};
  }
  const side = direction === "CALL"
    ? "แท่ง M1 ปิดบวกและปิดใกล้จุดสูง แสดงแรงซื้อ"
    : "แท่ง M1 ปิดลบและปิดใกล้จุดต่ำ แสดงแรงขาย";
  return {
    ready:true,decisionMade:true,signal:direction,candidateSignal:direction,
    score,confidence:score,sourceCandleEpoch,candleEpoch:sourceCandleEpoch,
    targetCandleEpoch,targetCandleAt:new Date(targetCandleEpoch*1000).toISOString(),
    strategy:"CLOSED_M1_TO_NEXT_M1_ENTRY",analysisMode:"CLOSED_M1_BODY_CONFIRMATION",
    decisionStrength:score>=80?"STRONG":"MODERATE",entryPrice:null,
    entryPriceBasis:"FIRST_FRESH_STREAM_TICK_OF_NEXT_M1",
    status:direction==="CALL"?"NEXT_M1_CLOSED_CONFIRM_CALL":"NEXT_M1_CLOSED_CONFIRM_PUT",
    metrics,evidenceSummary:side+" · วิเคราะห์จาก OHLC ของแท่ง M1 ที่ปิดสมบูรณ์แล้ว 1 แท่ง",
    alertId:"ENGINE_4:"+targetCandleEpoch+":"+direction+":CLOSED_M1",
    reason:direction+" · "+side+" · สัญญาณสำหรับแท่ง M1 ถัดไป"
  };
}
