const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export const BB_PERIOD = 20;
export const BB_DEVIATION = 2;

function valid(xs) {
  return Array.isArray(xs) && xs.length >= BB_PERIOD + 2 &&
    xs.every(c => c && c.live !== true &&
      [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
      c.low > 0 && c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) && c.high >= c.low);
}

function bands(xs, end) {
  const closes = xs.slice(end - BB_PERIOD + 1, end + 1).map(c => c.close);
  const middle = mean(closes);
  const deviation = Math.sqrt(mean(closes.map(x => (x - middle) ** 2)));
  return {
    middle,
    upper: middle + BB_DEVIATION * deviation,
    lower: middle - BB_DEVIATION * deviation,
    width: middle ? (BB_DEVIATION * 2 * deviation) / middle : 0
  };
}

function candlePressure(candle) {
  const range = Math.max(candle.high - candle.low, 1e-12);
  const bodyRatio = Math.abs(candle.close - candle.open) / range;
  const upperWickRatio = (candle.high - Math.max(candle.open, candle.close)) / range;
  const lowerWickRatio = (Math.min(candle.open, candle.close) - candle.low) / range;
  const closeLocation = (candle.close - candle.low) / range;
  const bullish = candle.close > candle.open;
  const bearish = candle.close < candle.open;
  const buying = clamp(
    0.45 * (bullish ? bodyRatio : 0) +
    0.30 * closeLocation +
    0.25 * lowerWickRatio
  );
  const selling = clamp(
    0.45 * (bearish ? bodyRatio : 0) +
    0.30 * (1 - closeLocation) +
    0.25 * upperWickRatio
  );
  return {
    buying, selling,
    bodyRatio, upperWickRatio, lowerWickRatio, closeLocation,
    bullish, bearish
  };
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  let current = values[0];
  const output = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

function rejection(candle, band, direction) {
  const p = candlePressure(candle);
  if (direction === "CALL") {
    const touched = candle.low <= band.lower;
    const reclaimed = candle.close > band.lower;
    const rejected = p.lowerWickRatio >= 0.30 && p.closeLocation >= 0.55;
    return { valid: touched && reclaimed && rejected && p.buying >= 0.48, pressure: p.buying };
  }
  const touched = candle.high >= band.upper;
  const reclaimed = candle.close < band.upper;
  const rejected = p.upperWickRatio >= 0.30 && p.closeLocation <= 0.45;
  return { valid: touched && reclaimed && rejected && p.selling >= 0.48, pressure: p.selling };
}

/**
 * BB Pure Scalper B-mode:
 * 1) A fully closed candle must touch an outer BB and close back inside with rejection wick.
 * 2) The next fully closed candle must break the rejection candle's high/low and confirm
 *    the matching buying/selling pressure.
 * No same-candle/immediate reversal signals are permitted.
 */
export function analyzeBBPureScalper(input) {
  const candles = Array.isArray(input) ? input.filter(c => c && c.live !== true) : [];
  if (!valid(candles)) {
    return {
      ready: false, signal: "STANDBY", setup: "NONE",
      strategy: "BB_PURE_SCALPER_STANDALONE_B",
      reason: "ต้องมีแท่ง M1 ปิดแล้วและ OHLC ถูกต้องอย่างน้อย 22 แท่ง",
      evidence: []
    };
  }

  const index = candles.length - 1;
  const previous = candles[index - 1];
  const current = candles[index];
  const currentBand = bands(candles, index);
  const previousBand = bands(candles, index - 1);
  const currentPressure = candlePressure(current);
  const previousPressure = candlePressure(previous);
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const slope = ema20[index] - ema20[index - 3];
  const expanding = currentBand.width > previousBand.width * 1.04;

  const priorThree = candles.slice(-4, -1);
  const bandWalkUp = priorThree.filter((c, offset) =>
    c.close > bands(candles, candles.length - 4 + offset).upper
  ).length >= 2;
  const bandWalkDown = priorThree.filter((c, offset) =>
    c.close < bands(candles, candles.length - 4 + offset).lower
  ).length >= 2;
  const bullishBandWalk = slope > 0 && expanding && bandWalkUp;
  const bearishBandWalk = slope < 0 && expanding && bandWalkDown;

  const currentLowerRejection = rejection(current, currentBand, "CALL");
  const currentUpperRejection = rejection(current, currentBand, "PUT");
  const priorLowerRejection = rejection(previous, previousBand, "CALL");
  const priorUpperRejection = rejection(previous, previousBand, "PUT");
  const callConfirmed =
    priorLowerRejection.valid &&
    current.close > previous.high &&
    currentPressure.buying >= 0.48 &&
    currentPressure.closeLocation >= 0.58 &&
    currentPressure.bullish;
  const putConfirmed =
    priorUpperRejection.valid &&
    current.close < previous.low &&
    currentPressure.selling >= 0.48 &&
    currentPressure.closeLocation <= 0.42 &&
    currentPressure.bearish;

  let signal = "STANDBY";
  let setup = "WAIT_FOR_BB_TOUCH_AND_REJECTION";
  let confirmed = false;
  let reason = "รอแท่งปิดแตะขอบ BB และยืนยันการกลับตัวด้วยแท่งถัดไป";

  if (callConfirmed && !bearishBandWalk) {
    signal = "CALL";
    setup = "CONFIRMED_REVERSAL";
    confirmed = true;
    reason = "แท่งก่อนปฏิเสธ BB ล่าง และแท่งล่าสุดปิดทะลุ High พร้อมแรงซื้อยืนยัน";
  } else if (putConfirmed && !bullishBandWalk) {
    signal = "PUT";
    setup = "CONFIRMED_REVERSAL";
    confirmed = true;
    reason = "แท่งก่อนปฏิเสธ BB บน และแท่งล่าสุดปิดทะลุ Low พร้อมแรงขายยืนยัน";
  } else if (bullishBandWalk || bearishBandWalk) {
    setup = "BAND_WALK_BLOCK";
    reason = "กรองสัญญาณกลับตัว: พบ Band Walk และแรงขยายตัวตามเทรนด์";
  } else if (currentLowerRejection.valid || currentUpperRejection.valid || priorLowerRejection.valid || priorUpperRejection.valid) {
    setup = "WAIT_FOR_CONFIRMATION";
    reason = currentLowerRejection.valid
      ? "แท่งล่าสุดแตะ BB ล่างและปิดกลับเข้ากรอบแล้ว · รอแท่งถัดไปยืนยันแรงซื้อ"
      : currentUpperRejection.valid
        ? "แท่งล่าสุดแตะ BB บนและปิดกลับเข้ากรอบแล้ว · รอแท่งถัดไปยืนยันแรงขาย"
        : "พบแท่งปฏิเสธขอบ BB แล้ว แต่แท่งล่าสุดยังไม่ยืนยันทะลุ High/Low";
  }

  return {
    ready: true,
    signal,
    direction: ["CALL", "PUT"].includes(signal) ? signal : null,
    setup,
    confirmed,
    reason,
    strategy: "BB_PURE_SCALPER_STANDALONE_B",
    provider: "LOCAL_BOLLINGER_PRICE_ACTION",
    evidence: [
      "BB(20,2) Upper " + currentBand.upper.toFixed(5) +
        " · Middle " + currentBand.middle.toFixed(5) +
        " · Lower " + currentBand.lower.toFixed(5),
      "แรงซื้อแท่งล่าสุด " + (currentPressure.buying * 100).toFixed(0) +
        "% · แรงขาย " + (currentPressure.selling * 100).toFixed(0) + "%",
      "ไส้บน " + (previousPressure.upperWickRatio * 100).toFixed(0) +
        "% · ไส้ล่าง " + (previousPressure.lowerWickRatio * 100).toFixed(0) + "% (แท่งก่อนหน้า)",
      "แท่งยืนยัน: " + (confirmed ? "ผ่าน" : "ยังไม่ผ่าน") +
        " · " + (currentPressure.bullish ? "แท่งเขียว" : currentPressure.bearish ? "แท่งแดง" : "แท่งไม่มีทิศทาง"),
      "EMA20 slope " + slope.toExponential(2) +
        " · " + (bullishBandWalk ? "UPPER BAND WALK" : bearishBandWalk ? "LOWER BAND WALK" : "ไม่พบ Band Walk ที่ยืนยัน")
    ],
    metrics: {
      period: BB_PERIOD, deviation: BB_DEVIATION,
      upper: currentBand.upper, middle: currentBand.middle, lower: currentBand.lower,
      bandwidth: currentBand.width,
      buyingPressure: currentPressure.buying,
      sellingPressure: currentPressure.selling,
      previousBuyingPressure: previousPressure.buying,
      previousSellingPressure: previousPressure.selling,
      upperWickRatio: previousPressure.upperWickRatio,
      lowerWickRatio: previousPressure.lowerWickRatio,
      bandExpanding: expanding,
      bullishBandWalk, bearishBandWalk,
      lastClosedCandleEpoch: current.epoch ?? null,
      previousClosedCandleEpoch: previous.epoch ?? null,
      confirmationCandleEpoch: current.epoch ?? null
    },
    riskFlags: bullishBandWalk || bearishBandWalk ? ["COUNTER_TREND_BAND_WALK_BLOCK"] : []
  };
}
