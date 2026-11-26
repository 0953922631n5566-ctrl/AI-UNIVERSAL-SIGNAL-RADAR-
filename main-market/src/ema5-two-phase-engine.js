export const STRATEGY_ID = "MA5_BOLLINGER_20_2_M1";
const PERIOD_BB = 20;
const PERIOD_MA = 5;
const PIP = 0.0001;
const MIN_HISTORY = 40;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function samplingPhase(epochSeconds) {
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
  if (direction === "CALL") return candle.close > candle.open || (lowerWick >= Math.max(body * 0.7, PIP * 0.25) && lowerWick > upperWick);
  return candle.close < candle.open || (upperWick >= Math.max(body * 0.7, PIP * 0.25) && upperWick > lowerWick);
}

export function analyzeMa5Bollinger({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  const wait = (reason, extra = {}) => ({ signal: "WAIT", regime: "WAIT", reason, strategy: STRATEGY_ID, ...extra });
  if (symbol !== "EUR/USD") return wait("ระบบนี้รองรับเฉพาะ EUR/USD");
  if (!liveCandle || liveCandle.live !== true) return wait("รอแท่ง M1 ปัจจุบัน");
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) return wait("ราคา Streaming ไม่สดเกิน 5 วินาที");
  const closed = [...(closedCandles || [])].filter(c => c && c.live !== true && Number.isFinite(c.epoch))
    .sort((a, b) => a.epoch - b.epoch);
  if (closed.length < MIN_HISTORY) return wait(`ประวัติแท่งปิดไม่พอ (${closed.length}/${MIN_HISTORY})`);
  const candles = [...closed, liveCandle];
  if (candles.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite))) return wait("ข้อมูล OHLC ไม่สมบูรณ์");
  const closes = candles.map(c => Number(c.close));
  const currentBands = bands(closes);
  const ma5 = mean(closes.slice(-PERIOD_MA));
  const previousMa5 = mean(closes.slice(-PERIOD_MA - 1, -1));
  const maSlopePips = (ma5 - previousMa5) / PIP;
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

export const EMA5_MIN_HISTORY = MIN_HISTORY;
