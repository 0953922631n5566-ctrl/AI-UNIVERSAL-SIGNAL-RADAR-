const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function calibrateCandles(candles, axisPrices) {
  const axis = (Array.isArray(axisPrices) ? axisPrices : [])
    .filter(point => finite(point?.price) && finite(point?.y))
    .sort((a, b) => Number(a.y) - Number(b.y));
  if (axis.length < 2) return [];
  const first = axis[0];
  const last = axis.at(-1);
  const ySpan = Number(last.y) - Number(first.y);
  const priceSpan = Number(last.price) - Number(first.price);
  if (Math.abs(ySpan) < 10 || Math.abs(priceSpan) <= 0) return [];
  const toPrice = y => finite(y)
    ? Number(first.price) + (Number(y) - Number(first.y)) * priceSpan / ySpan
    : null;
  return (Array.isArray(candles) ? candles : []).slice(-12).map(candle => {
    const open = toPrice(candle.openY);
    const close = toPrice(candle.closeY);
    const high = toPrice(candle.highY);
    const low = toPrice(candle.lowY);
    if (![open, close, high, low].every(Number.isFinite)) return null;
    const top = Math.max(high, low, open, close);
    const bottom = Math.min(high, low, open, close);
    const range = top - bottom;
    if (!(range > 0)) return null;
    const upperWick = Math.max(0, top - Math.max(open, close));
    const lowerWick = Math.max(0, Math.min(open, close) - bottom);
    return {
      open, close, high: top, low: bottom, range,
      body: Math.abs(close - open),
      direction: close > open ? 1 : close < open ? -1 : 0,
      upperWickRatio: upperWick / range,
      lowerWickRatio: lowerWick / range,
      bodyRatio: Math.abs(close - open) / range
    };
  }).filter(Boolean);
}

/**
 * Predicts the direction of the next candle using only APK-supplied live price,
 * OCR-calibrated candle geometry and visible price-axis labels.
 * It intentionally fails closed when the chart cannot be calibrated.
 */
export function predictNextCandle({ candles, axisPrices, price }) {
  if (!finite(price) || Number(price) <= 0) {
    return { signal: "WAIT", status: "PRICE_UNREADABLE", reason: "ยังอ่านราคาจาก APK ไม่ได้", source: "APK_PRICE_AND_CANDLE_GEOMETRY" };
  }
  const calibrated = calibrateCandles(candles, axisPrices);
  if (calibrated.length < 4) {
    return {
      signal: "WAIT", status: "CANDLE_DATA_INSUFFICIENT",
      reason: "ต้องมีแท่งเทียนที่เทียบกับแกนราคาได้อย่างน้อย 4 แท่ง",
      calibratedCandles: calibrated.length, source: "APK_PRICE_AND_CANDLE_GEOMETRY"
    };
  }

  const recent = calibrated.slice(-5);
  const latest = recent.at(-1);
  const meanRange = recent.reduce((sum, candle) => sum + candle.range, 0) / recent.length;
  if (!(meanRange > 0) || latest.range < meanRange * 0.08) {
    return { signal: "WAIT", status: "CANDLE_RANGE_TOO_SMALL", reason: "ช่วงแกว่งของแท่งล่าสุดเล็กเกินไปสำหรับคาดการณ์", calibratedCandles: calibrated.length, source: "APK_PRICE_AND_CANDLE_GEOMETRY" };
  }

  // Normalize candle bodies and recent close-to-close movement by the observed range.
  const directionWeights = recent.map((candle, index) => {
    const recency = index + 1;
    return candle.direction * Math.min(candle.bodyRatio, 1) * recency;
  });
  const directionTotal = directionWeights.reduce((sum, value) => sum + value, 0);
  const directionScale = recent.reduce((sum, candle, index) => sum + index + 1, 0);
  const bodyPressure = directionTotal / directionScale;

  const trendMove = (latest.close - recent[0].close) / (meanRange * recent.length);
  const trendPressure = Math.max(-1, Math.min(1, trendMove));
  const rejectionPressure = latest.lowerWickRatio - latest.upperWickRatio;
  const closeLocation = ((latest.close - latest.low) / latest.range) * 2 - 1;
  const latestBody = latest.direction * latest.bodyRatio;

  const directionalEvidence = bodyPressure * 0.38 + trendPressure * 0.28 +
    rejectionPressure * 0.18 + closeLocation * 0.10 + latestBody * 0.06;

  const doji = latest.bodyRatio < 0.10;
  const lastTwoOppose = recent.at(-2).direction !== 0 &&
    latest.direction !== 0 && recent.at(-2).direction !== latest.direction;
  const strongRejection = Math.max(latest.upperWickRatio, latest.lowerWickRatio) >= 0.58 &&
    latest.bodyRatio <= 0.30;
  const hasDirectionalContext = Math.abs(bodyPressure) >= 0.10 ||
    Math.abs(trendPressure) >= 0.10 || strongRejection;
  const minimumEvidence = doji ? 0.16 : 0.12;

  let signal = "WAIT";
  if (hasDirectionalContext && directionalEvidence >= minimumEvidence) signal = "CALL";
  if (hasDirectionalContext && directionalEvidence <= -minimumEvidence) signal = "PUT";

  let reason;
  if (signal === "WAIT") {
    reason = doji
      ? "แท่งล่าสุดมีลักษณะลังเล รอข้อมูลแท่งถัดไปยืนยัน"
      : "แรงส่ง รูปทรงแท่งเทียน และตำแหน่งปิดยังไม่สอดคล้องกันพอ";
  } else if (strongRejection && ((signal === "CALL" && latest.lowerWickRatio > latest.upperWickRatio) ||
      (signal === "PUT" && latest.upperWickRatio > latest.lowerWickRatio))) {
    reason = signal === "CALL"
      ? "พบแรงปฏิเสธราคาด้านล่างและแรงซื้อกลับ สนับสนุนแท่งถัดไปขึ้น"
      : "พบแรงปฏิเสธราคาด้านบนและแรงขายกลับ สนับสนุนแท่งถัดไปลง";
  } else {
    reason = signal === "CALL"
      ? "แรงส่งและโครงสร้างแท่งเทียนล่าสุดสนับสนุนการขึ้นของแท่งถัดไป"
      : "แรงส่งและโครงสร้างแท่งเทียนล่าสุดสนับสนุนการลงของแท่งถัดไป";
  }

  const confidence = signal === "WAIT" ? "LOW" :
    Math.abs(directionalEvidence) >= 0.34 && !lastTwoOppose ? "HIGH" : "MEDIUM";
  return {
    signal,
    status: signal === "WAIT" ? "NO_CLEAR_DIRECTION" : "NEXT_CANDLE_PREDICTED",
    target: "NEXT_CANDLE",
    reason,
    confidence,
    calibratedCandles: calibrated.length,
    evidence: {
      recentBodyPressure: Number(bodyPressure.toFixed(3)),
      recentTrend: Number(trendPressure.toFixed(3)),
      latestUpperWickRatio: Number(latest.upperWickRatio.toFixed(3)),
      latestLowerWickRatio: Number(latest.lowerWickRatio.toFixed(3)),
      latestBodyRatio: Number(latest.bodyRatio.toFixed(3)),
      doji,
      opposingLastTwoCandles: lastTwoOppose
    },
    source: "APK_PRICE_AND_CANDLE_GEOMETRY"
  };
}
