export const EMA5_STRATEGY_ID = "EMA5_PULLBACK_SR_TWO_PHASE_M1";
const EMA_PERIOD = 5;
const EMA_ALPHA = 2 / (EMA_PERIOD + 1);
const MIN_HISTORY = 20;
const PIP = 0.0001;
const SR_LOOKBACK = 15;
const SR_NEAR_PIPS = 5.0;
const SR_CLEAR_PIPS = 2.0;
const EMA_RETEST_TOLERANCE_PIPS = 1.5;
const SLOPE_FLAT_PIPS = 0.05;

export function samplingPhase(epochSeconds) {
  const second = ((Math.floor(epochSeconds) % 60) + 60) % 60;
  if (second <= 2) return "OPEN";
  if (second >= 55) return "PREPARE";
  return "COLLECT";
}
export function calculateEma5(closes) {
  const values = closes.map(Number).filter(Number.isFinite);
  if (values.length < EMA_PERIOD + 1) return null;
  const seed = values.slice(0, EMA_PERIOD).reduce((sum, value) => sum + value, 0) / EMA_PERIOD;
  let ema = seed; const result = [ema];
  for (let i = EMA_PERIOD; i < values.length; i++) { ema = values[i] * EMA_ALPHA + ema * (1 - EMA_ALPHA); result.push(ema); }
  return { current: result.at(-1), previous: result.at(-2) };
}
function findZones(candles) {
  const recent = candles.slice(-SR_LOOKBACK), supports = [], resistances = [];
  for (let i = 1; i < recent.length - 1; i++) {
    const c = recent[i], p = recent[i - 1], n = recent[i + 1];
    if (c.low <= p.low && c.low <= n.low) supports.push(c.low);
    if (c.high >= p.high && c.high >= n.high) resistances.push(c.high);
  }
  return { support: supports.length ? Math.max(...supports) : Math.min(...recent.map(c => c.low)),
    resistance: resistances.length ? Math.min(...resistances) : Math.max(...recent.map(c => c.high)) };
}
export function analyzeEma5Pullback({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  if (symbol !== "EUR/USD") return { signal:"WAIT", slope:"WAIT", reason:"ระบบนี้ล็อกเฉพาะ EUR/USD" };
  if (!liveCandle || liveCandle.live !== true) return { signal:"WAIT", slope:"WAIT", reason:"รอแท่ง M1 ปัจจุบัน" };
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) return { signal:"WAIT", slope:"WAIT", reason:"รอราคา Streaming สดไม่เกิน 5 วินาที" };
  const closed = [...(closedCandles || [])].filter(c => c && c.live !== true && Number.isFinite(c.epoch)).sort((a,b)=>a.epoch-b.epoch);
  if (closed.length < MIN_HISTORY) return { signal:"WAIT", slope:"WAIT", reason:`ประวัติแท่งปิดไม่พอ (${closed.length}/${MIN_HISTORY})` };
  const recent = closed.slice(-SR_LOOKBACK), closes = [...closed.map(c=>Number(c.close)), Number(liveCandle.close)];
  if (closes.some(v=>!Number.isFinite(v)) || ![liveCandle.open,liveCandle.high,liveCandle.low,liveCandle.close].every(Number.isFinite))
    return { signal:"WAIT", slope:"WAIT", reason:"OHLC ไม่สมบูรณ์" };
  const ema=calculateEma5(closes); if(!ema)return{signal:"WAIT",slope:"WAIT",reason:"คำนวณ EMA5 ไม่สำเร็จ"};
  const delta=ema.current-ema.previous, slopePips=delta/PIP;
  const slope=Math.abs(slopePips)<SLOPE_FLAT_PIPS?"FLAT":delta>0?"UP":"DOWN";
  const zones=findZones(recent), supportDistancePips=(liveCandle.close-zones.support)/PIP, resistanceDistancePips=(zones.resistance-liveCandle.close)/PIP;
  const nearSupport=liveCandle.low<=zones.support+SR_NEAR_PIPS*PIP && liveCandle.low>=zones.support-SR_NEAR_PIPS*PIP;
  const nearResistance=liveCandle.high>=zones.resistance-SR_NEAR_PIPS*PIP && liveCandle.high<=zones.resistance+SR_NEAR_PIPS*PIP;
  const supportIntact=liveCandle.low>=zones.support-SR_NEAR_PIPS*PIP;
  const resistanceIntact=liveCandle.high<=zones.resistance+SR_NEAR_PIPS*PIP;
  const common={ema5:ema.current,previousEma5:ema.previous,slope,slopePips:Number(slopePips.toFixed(3)),
    openPrice:liveCandle.open,closePrice:liveCandle.close,highPrice:liveCandle.high,lowPrice:liveCandle.low,
    support:zones.support,resistance:zones.resistance,supportDistancePips:Number(supportDistancePips.toFixed(1)),
    resistanceDistancePips:Number(resistanceDistancePips.toFixed(1)),nearSupport,nearResistance,supportIntact,resistanceIntact,srLookback:SR_LOOKBACK,
    sourceCandleEpoch:liveCandle.epoch,targetCandleEpoch:liveCandle.epoch+60,tickAgeSeconds:Number(tickAgeSeconds.toFixed(2)),
    indicator:"EMA5",source:"Twelve Data M1 OHLC + local EMA5 + local swing S/R"};
  if(slope==="FLAT")return{...common,signal:"WAIT",regime:"SIDEWAY",reason:"EMA5 แบนราบ · SIDEWAY · งดส่งสัญญาณ"};
  if(slope==="UP"&&supportIntact&&(liveCandle.low<=ema.current+EMA_RETEST_TOLERANCE_PIPS*PIP||nearSupport)&&liveCandle.close>liveCandle.open&&liveCandle.close>ema.current&&Math.abs(resistanceDistancePips)>SR_CLEAR_PIPS)
    return{...common,signal:"CALL",regime:"UPTREND",reason:`EMA5 UP + Pullback + ${nearSupport?"Near Support":"EMA5 Retest"} · ยังมีระยะถึงแนวต้านย่อย`};
  if(slope==="DOWN"&&resistanceIntact&&(liveCandle.high>=ema.current-EMA_RETEST_TOLERANCE_PIPS*PIP||nearResistance)&&liveCandle.close<liveCandle.open&&liveCandle.close<ema.current&&Math.abs(supportDistancePips)>SR_CLEAR_PIPS)
    return{...common,signal:"PUT",regime:"DOWNTREND",reason:`EMA5 DOWN + Pullback + ${nearResistance?"Near Resistance":"EMA5 Retest"} · ยังมีระยะถึงแนวรับย่อย`};
  if((slope==="UP"&&!supportIntact)||(slope==="DOWN"&&!resistanceIntact)||(slope==="UP"&&resistanceDistancePips<=SR_CLEAR_PIPS)||(slope==="DOWN"&&supportDistancePips<=SR_CLEAR_PIPS))
    return{...common,signal:"WAIT",regime:"SR_BLOCK",reason:"ราคาอยู่ชิดแนวต้าน/แนวรับย่อย · เสี่ยงชนโซนกลับตัว"};
  if(Math.abs(supportDistancePips)>25&&Math.abs(resistanceDistancePips)>25)
    return{...common,signal:"WAIT",regime:"NO_ZONE",reason:"ราคาอยู่กลางทาง · ยังไม่มีโซน S/R ใกล้เคียง"};
  return{...common,signal:"WAIT",regime:"WAIT",reason:"ยังไม่ครบเงื่อนไข EMA5 Pullback + S/R"};
}
export function enterPreparedSignal(state,targetEpoch) {
  if(!state||!Number.isFinite(targetEpoch)||state.preparedForEpoch!==targetEpoch||!["CALL","PUT"].includes(state.preparedSignal)||state.enteredEpoch===targetEpoch)return null;
  state.enteredEpoch=targetEpoch;state.phase="ENTER";state.signal=state.preparedSignal;
  state.alertId=`${state.sourceEpoch}:${targetEpoch}:${state.preparedSignal}:EMA5_SR`;
  state.enteredAt=new Date(targetEpoch*1000).toISOString();
  state.history=[{id:state.alertId,signal:state.signal,sourceEpoch:state.sourceEpoch,targetEpoch,issuedAt:state.enteredAt,status:"ENTER"},...(state.history||[])].slice(0,10);
  return{signal:state.signal,alertId:state.alertId,targetEpoch};
}
export const EMA5_MIN_HISTORY=MIN_HISTORY;

export const STRATEGY_ID = "MA5_BOLLINGER_20_2_M1";
const PERIOD_BB = 20;
const PERIOD_MA = 5;
const BB_PIP = 0.0001;
const BB_MIN_HISTORY = 40;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function bollingerSamplingPhase(epochSeconds) {
  const second = ((Math.floor(epochSeconds) % 60) + 60) % 60;
  if (second >= 55) return "ORDER";
  if (second >= 50) return "WATCH";
  return "COLLECT";
}

function mean(values) { return values.reduce((a, b) => a + b, 0) / values.length; }
function bands(values) {
  if (values.length < PERIOD_BB) return null;
  const sample = values.slice(-PERIOD_BB);
  const mid = mean(sample);
  const variance = mean(sample.map(v => (v - mid) ** 2));
  const sd = Math.sqrt(variance);
  return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd, width: 4 * sd, sd };
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function bandWidthHistory(closes) {
  const out = [];
  for (let end = PERIOD_BB; end < closes.length - 1; end++) {
    const b = bands(closes.slice(0, end));
    if (b && Number.isFinite(b.width) && b.width > 0) out.push(b.width);
  }
  return out.slice(-24);
}
function rejection(candle, direction) {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  if (direction === "CALL") return candle.close > candle.open || (lowerWick >= Math.max(body * 0.7, BB_PIP * 0.25) && lowerWick > upperWick);
  return candle.close < candle.open || (upperWick >= Math.max(body * 0.7, BB_PIP * 0.25) && upperWick > lowerWick);
}

export function analyzeMa5Bollinger({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  const wait = (reason, extra = {}) => ({ signal: "WAIT", regime: "WAIT", reason, strategy: STRATEGY_ID, ...extra });
  if (symbol !== "EUR/USD") return wait("ระบบนี้รองรับเฉพาะ EUR/USD");
  if (!liveCandle || liveCandle.live !== true) return wait("รอแท่ง M1 ปัจจุบัน");
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) return wait("ราคา Streaming ไม่สดเกิน 5 วินาที");
  const closed = [...(closedCandles || [])].filter(c => c && c.live !== true && Number.isFinite(c.epoch))
    .sort((a, b) => a.epoch - b.epoch);
  if (closed.length < BB_MIN_HISTORY) return wait(`ประวัติแท่งปิดไม่พอ (${closed.length}/${BB_MIN_HISTORY})`);
  const candles = [...closed, liveCandle];
  if (candles.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite))) return wait("ข้อมูล OHLC ไม่สมบูรณ์");
  const closes = candles.map(c => Number(c.close));
  const currentBands = bands(closes);
  const ma5 = mean(closes.slice(-PERIOD_MA));
  const previousMa5 = mean(closes.slice(-PERIOD_MA - 1, -1));
  const maSlopePips = (ma5 - previousMa5) / BB_PIP;
  const widthHistory = bandWidthHistory(closes);
  const typicalWidth = median(widthHistory);
  if (!currentBands || !typicalWidth || currentBands.width <= 0) return wait("คำนวณ BB(20,2) ไม่สำเร็จ");
  const { upper, mid, lower, width } = currentBands;
  const c = liveCandle;
  const position = clamp((c.close - lower) / width, 0, 1);
  const lowerZone = c.low <= lower + width * 0.20 && c.low >= lower - width * 0.25;
  const upperZone = c.high >= upper - width * 0.20 && c.high <= upper + width * 0.25;
  const maNearCall = Math.min(Math.abs(c.low - ma5), Math.abs(c.close - ma5)) <= Math.max(width * 0.16, 0.00008);
  const maNearPut = Math.min(Math.abs(c.high - ma5), Math.abs(c.close - ma5)) <= Math.max(width * 0.16, 0.00008);
  const expanded = width > typicalWidth * 1.55;
  const squeezed = width < typicalWidth * 0.65;
  const recent3 = closed.slice(-3);
  const edgeRideLow = recent3.filter(x => x.close <= lower + width * 0.20).length >= 2;
  const edgeRideHigh = recent3.filter(x => x.close >= upper - width * 0.20).length >= 2;
  const common = {
    ma5, previousMa5, maSlopePips: Number(maSlopePips.toFixed(2)),
    bbUpper: upper, bbMiddle: mid, bbLower: lower, bbWidth: width,
    bbWidthRatio: Number((width / typicalWidth).toFixed(2)), typicalBbWidth: typicalWidth,
    bandPosition: Number(position.toFixed(3)), lowerZone, upperZone, maNearCall, maNearPut,
    expanded, squeezed, edgeRideLow, edgeRideHigh, sourceCandleEpoch: c.epoch,
    targetCandleEpoch: c.epoch + 60, tickAgeSeconds: Number(tickAgeSeconds.toFixed(2)),
    indicator: "SMA5 + Bollinger Bands(20,2)", source: "Twelve Data real M1 OHLC"
  };
  if (expanded && ((edgeRideLow && position < 0.35) || (edgeRideHigh && position > 0.65))) {
    return { ...wait("WAIT · BB กางกว้างและราคาเกาะขอบต่อเนื่อง · ห้ามสวนแรงส่ง", { ...common, regime: "EXPANSION_EDGE_RIDE" }) };
  }
  if (squeezed && position >= 0.35 && position <= 0.65) {
    return { ...wait("WAIT · BB บีบแคบและราคาอยู่กลางกรอบ · รอให้มีทิศทาง", { ...common, regime: "SQUEEZE_MID" }) };
  }
  const body = Math.abs(c.close - c.open);
  if (body > width * 0.55) return wait("WAIT · แท่งเร่งแรงเกินไป เสี่ยงไล่ราคา", common);
  const callMaStable = maSlopePips >= -0.12;
  const putMaStable = maSlopePips <= 0.12;
  const callRejection = rejection(c, "CALL");
  const putRejection = rejection(c, "PUT");
  const callNotBroken = c.low >= lower - width * 0.25;
  const putNotBroken = c.high <= upper + width * 0.25;
  if ((lowerZone || maNearCall) && callMaStable && callRejection && callNotBroken) {
    return { ...common, signal: "CALL", regime: "LOWER_BAND_REJECTION", reason: `MA5 ทรงตัว/เริ่มขึ้น + ปฏิเสธแรงขายใกล้ขอบล่าง BB หรือ MA5` };
  }
  if ((upperZone || maNearPut) && putMaStable && putRejection && putNotBroken) {
    return { ...common, signal: "PUT", regime: "UPPER_BAND_REJECTION", reason: `MA5 ทรงตัว/เริ่มลง + ปฏิเสธแรงซื้อใกล้ขอบบน BB หรือ MA5` };
  }
  return wait("ยังไม่ครบเงื่อนไข MA5 + BB(20,2) และแท่งปฏิเสธ", common);
}

export const MA5_BB_MIN_HISTORY = BB_MIN_HISTORY;


export const EMA5_SCORE_STRATEGY_ID = "EURUSD_EMA5_RSI14_SCORE_80_M1";
const EMA5_SCORE_MIN_HISTORY = 20;
const EMA5_SCORE_PIP = 0.0001;
const EMA5_SCORE_THRESHOLD = 80;
const EMA5_SCORE_RETEST_TOLERANCE = 0.0001;
const RSI_PERIOD = 14;

/** Wilder RSI(14), calculated locally from Twelve Data M1 close prices. */
export function calculateRsi14(closes) {
  const values = closes.map(Number);
  if (values.length < RSI_PERIOD + 1 || values.some(v => !Number.isFinite(v))) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / RSI_PERIOD, avgLoss = loss / RSI_PERIOD;
  const toRsi = (g, l) => l === 0 ? (g === 0 ? 50 : 100) : g === 0 ? 0 : 100 - 100 / (1 + g / l);
  let previous = toRsi(avgGain, avgLoss);
  for (let i = RSI_PERIOD + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (RSI_PERIOD - 1) + Math.max(change, 0)) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + Math.max(-change, 0)) / RSI_PERIOD;
    previous = toRsi(avgGain, avgLoss);
  }
  return { current: toRsi(avgGain, avgLoss), previous };
}

/**
 * EMA5 + RSI14 directional scoring. Core alignment = 80 points:
 * EMA slope 25, close side of EMA5 20, candle direction 15,
 * RSI14 direction confirmation 20. A clean EMA5 retest adds 20 bonus.
 */
export function analyzeEma5Score({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  const wait = (reason, extra = {}) => ({
    signal: "WAIT", regime: "WAIT", reason,
    strategy: EMA5_SCORE_STRATEGY_ID, threshold: EMA5_SCORE_THRESHOLD,
    score: 0, callScore: 0, putScore: 0, ...extra
  });
  if (symbol !== "EUR/USD") return wait("ระบบนี้รองรับเฉพาะ EUR/USD");
  if (!liveCandle || liveCandle.live !== true) return wait("รอแท่ง M1 ปัจจุบัน");
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) return wait("ราคา Streaming ไม่สดเกิน 5 วินาที");
  const closed = [...(closedCandles || [])]
    .filter(c => c && c.live !== true && Number.isFinite(c.epoch))
    .sort((a, b) => a.epoch - b.epoch);
  if (closed.length < EMA5_SCORE_MIN_HISTORY) {
    return wait(`ประวัติแท่งปิดไม่พอ (${closed.length}/${EMA5_SCORE_MIN_HISTORY})`);
  }
  const candles = [...closed, liveCandle];
  if (candles.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return wait("ข้อมูล OHLC ไม่สมบูรณ์");
  }
  const closes = candles.map(c => Number(c.close));
  const ema = calculateEma5(closes);
  if (!ema || !Number.isFinite(ema.current) || !Number.isFinite(ema.previous)) {
    return wait("คำนวณ EMA5 ไม่สำเร็จ");
  }
  const rsi = calculateRsi14(closes);
  if (!rsi || !Number.isFinite(rsi.current)) return wait("ข้อมูลไม่พอคำนวณ RSI(14)");
  const c = liveCandle;
  const slopePips = (ema.current - ema.previous) / EMA5_SCORE_PIP;
  const slopeUp = slopePips > 0.02;
  const slopeDown = slopePips < -0.02;
  const closeAbove = c.close > ema.current;
  const closeBelow = c.close < ema.current;
  const bullish = c.close > c.open;
  const bearish = c.close < c.open;
  const rsiCallConfirm = rsi.current > 50;
  const rsiPutConfirm = rsi.current < 50;
  const callRetest = c.low <= ema.current + EMA5_SCORE_RETEST_TOLERANCE &&
    c.close > ema.current && (Math.min(c.open, c.close) - c.low) > (c.high - Math.max(c.open, c.close));
  const putRetest = c.high >= ema.current - EMA5_SCORE_RETEST_TOLERANCE &&
    c.close < ema.current && (c.high - Math.max(c.open, c.close)) > (Math.min(c.open, c.close) - c.low);
  const callScore = (slopeUp ? 25 : 0) + (closeAbove ? 20 : 0) + (bullish ? 15 : 0) + (rsiCallConfirm ? 20 : 0) + (callRetest ? 20 : 0);
  const putScore = (slopeDown ? 25 : 0) + (closeBelow ? 20 : 0) + (bearish ? 15 : 0) + (rsiPutConfirm ? 20 : 0) + (putRetest ? 20 : 0);
  const score = Math.max(callScore, putScore);
  const common = {
    ema5: ema.current,
    previousEma5: ema.previous,
    ema5SlopePips: Number(slopePips.toFixed(3)),
    rsi14: Number(rsi.current.toFixed(2)),
    previousRsi14: Number(rsi.previous.toFixed(2)),
    rsiSignal: rsiCallConfirm ? "BULLISH" : rsiPutConfirm ? "BEARISH" : "NEUTRAL",
    slope: slopeUp ? "UP" : slopeDown ? "DOWN" : "FLAT",
    callScore, putScore, score, threshold: EMA5_SCORE_THRESHOLD,
    scoreParts: {
      ema5Slope: 25, closeSideOfEma5: 20, candleDirection: 15,
      rsi14Direction: 20, ema5RetestBonus: 20,
      call: { slope: slopeUp, closeAbove, bullish, rsiConfirm: rsiCallConfirm, retest: callRetest },
      put: { slope: slopeDown, closeBelow, bearish, rsiConfirm: rsiPutConfirm, retest: putRetest }
    },
    openPrice: c.open, closePrice: c.close, highPrice: c.high, lowPrice: c.low,
    sourceCandleEpoch: c.epoch, targetCandleEpoch: c.epoch + 60,
    tickAgeSeconds: Number(tickAgeSeconds.toFixed(2)),
    indicator: "EMA5 + RSI14",
    source: "Twelve Data real M1 OHLC + local EMA5 + Wilder RSI14"
  };
  if (callScore >= EMA5_SCORE_THRESHOLD) {
    return { ...common, signal: "CALL", regime: "EMA5_RSI_BULLISH", reason: `EMA5 ขาขึ้น + ปิดเหนือ EMA5 + แท่งเขียว + RSI14 ${rsi.current.toFixed(1)} ยืนยันแรงซื้อ · คะแนน ${callScore}/100 (เกณฑ์ 80)` };
  }
  if (putScore >= EMA5_SCORE_THRESHOLD) {
    return { ...common, signal: "PUT", regime: "EMA5_RSI_BEARISH", reason: `EMA5 ขาลง + ปิดใต้ EMA5 + แท่งแดง + RSI14 ${rsi.current.toFixed(1)} ยืนยันแรงขาย · คะแนน ${putScore}/100 (เกณฑ์ 80)` };
  }
  return {
    ...common, signal: "WAIT", regime: "EMA5_RSI_WAIT",
    reason: `รอ EMA5 และ RSI14 ยืนยันทิศทาง · RSI ${rsi.current.toFixed(1)} · CALL ${callScore}/100 · PUT ${putScore}/100 · ต้องถึง 80 คะแนน`
  };
}

export const EMA5_SCORE_MIN_HISTORY_EXPORT = EMA5_SCORE_MIN_HISTORY;
