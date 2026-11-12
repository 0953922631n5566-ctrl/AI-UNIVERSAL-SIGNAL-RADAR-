import { MAX_STREAM_AGE_SECONDS } from "./config.js";

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const validCandle = candle => candle && Number.isFinite(candle.epoch) &&
  [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
  candle.low > 0 && candle.close > 0 &&
  candle.high >= Math.max(candle.open, candle.close) &&
  candle.low <= Math.min(candle.open, candle.close) &&
  candle.high >= candle.low;

function ema(values, period = 5) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  let current = values[0];
  const result = [current];
  for (let i = 1; i < values.length; i++) {
    current = values[i] * alpha + current * (1 - alpha);
    result.push(current);
  }
  return result;
}

function atr(candles, period = 14) {
  const ranges = candles.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - candles[index].close),
    Math.abs(candle.low - candles[index].close)
  ));
  return mean(ranges.slice(-period));
}

function aggregateM5(candles) {
  const groups = new Map();
  for (const candle of candles) {
    const epoch = Math.floor(candle.epoch / 300) * 300;
    const group = groups.get(epoch) || { epoch, candles: [] };
    group.candles.push(candle);
    groups.set(epoch, group);
  }
  return [...groups.values()].sort((a, b) => a.epoch - b.epoch).map(group => {
    const rows = group.candles.sort((a, b) => a.epoch - b.epoch);
    const contiguous = rows.every((row, index) => index === 0 || row.epoch === rows[index - 1].epoch + 60);
    return {
      epoch: group.epoch, count: rows.length, complete: rows.length === 5 &&
        rows[0].epoch === group.epoch && rows[4].epoch === group.epoch + 240 && contiguous,
      open: rows[0].open, high: Math.max(...rows.map(row => row.high)),
      low: Math.min(...rows.map(row => row.low)), close: rows.at(-1).close
    };
  });
}

function standby(reason, extra = {}) {
  return {
    signal: "STANDBY", direction: null, score: 0, confidence: 0,
    regime: "UNCLEAR", strategy: "M5_LIVE_DIRECTION_M1_PULLBACK_CONFIRMATION",
    provider: "TWELVE_DATA_LIVE_STREAM", reason, summary: reason,
    evidence: [], riskFlags: [], metrics: null, ...extra
  };
}

/**
 * Production M5/M1 analyzer. The active M1 candle must be built from Twelve Data
 * Streaming ticks. Historical closed M1 candles may come from Twelve Data REST.
 * No generated, replayed, or simulated price path is accepted here.
 */
export function analyzeM5LiveM1Entry(candles, options = {}) {
  const tickAgeSeconds = options.tickAgeSeconds;
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds < 0 || tickAgeSeconds > MAX_STREAM_AGE_SECONDS) {
    return standby("ไม่มีราคา Streaming สดจาก Twelve Data — ระงับการวิเคราะห์และ CALL/PUT", {
      dataMode: "UNAVAILABLE", livePriceReady: false, riskFlags: ["LIVE_STREAM_REQUIRED"]
    });
  }

  if (!Array.isArray(candles) || candles.length < 35 || !candles.every(validCandle)) {
    return standby("ข้อมูล M1 จาก Twelve Data ไม่ครบหรือ OHLC ไม่ถูกต้อง", {
      dataMode: "STREAMING", livePriceReady: false, riskFlags: ["INVALID_OR_INSUFFICIENT_M1_DATA"]
    });
  }

  const ordered = candles.every((candle, index) =>
    index === 0 || candle.epoch > candles[index - 1].epoch
  );
  const live = candles.at(-1);
  const closed = candles.filter(candle => candle.live !== true);
  if (!ordered || live.live !== true || closed.length < 30 ||
      live.epoch !== Math.floor(Date.now() / 60000) * 60 &&
      Number.isFinite(options.now) && live.epoch !== Math.floor(options.now / 60000) * 60) {
    return standby("ต้องใช้แท่ง M1 ปัจจุบันที่กำลังก่อตัวจากราคา Streaming สด", {
      dataMode: "STREAMING", livePriceReady: false, riskFlags: ["CURRENT_LIVE_M1_REQUIRED"]
    });
  }

  const m5Groups = aggregateM5(candles);
  const currentM5 = m5Groups.at(-1);
  const priorM5 = m5Groups.filter(group => group.complete && group.epoch < currentM5.epoch);
  if (!currentM5 || currentM5.count < 1 || priorM5.length < 5) {
    return standby("ข้อมูลแท่ง M5 ปิดย้อนหลังไม่เพียงพอสำหรับยืนยันทิศทาง", {
      dataMode: "STREAMING", livePriceReady: true, riskFlags: ["INSUFFICIENT_M5_CONTEXT"]
    });
  }

  const prior = priorM5.at(-1);
  const beforePrior = priorM5.at(-2);
  const m5Atr = atr(priorM5, 14);
  const m5Body = currentM5.close - currentM5.open;
  const midpoint = (prior.high + prior.low) / 2;
  const m5Bull = m5Body > m5Atr * 0.08 &&
    currentM5.close > prior.close && prior.close > beforePrior.close &&
    currentM5.close > midpoint;
  const m5Bear = m5Body < -m5Atr * 0.08 &&
    currentM5.close < prior.close && prior.close < beforePrior.close &&
    currentM5.close < midpoint;
  const bias = m5Bull ? "CALL" : m5Bear ? "PUT" : "WAIT";

  const recentClosed = closed.slice(-30);
  const closes = recentClosed.slice(-5).map(candle => candle.close);
  const ema5 = ema(closes, 5).at(-1);
  const m1Atr = atr(recentClosed, 14);
  const previous = closed.at(-1);
  const tolerance = Math.max(m1Atr * 0.20, Number.EPSILON);
  const current = live;
  const pullback = bias === "CALL"
    ? current.low <= ema5 + tolerance
    : bias === "PUT" ? current.high >= ema5 - tolerance : false;
  const confirmed = bias === "CALL"
    ? current.close > ema5 && current.close > previous.high && current.close > current.open
    : bias === "PUT"
      ? current.close < ema5 && current.close < previous.low && current.close < current.open
      : false;
  const extension = m1Atr > 0 ? Math.abs(current.close - ema5) / m1Atr : Infinity;
  const notExtended = extension <= 1.40;
  const alreadyUsed = options.lastM5SignalBlock === currentM5.epoch;

  const metrics = {
    m5BlockEpoch: currentM5.epoch, m5BarsInProgress: currentM5.count,
    m5Open: currentM5.open, m5High: currentM5.high, m5Low: currentM5.low,
    m5LivePrice: currentM5.close, m5Atr, m5Body,
    m1Ema5: ema5, m1Atr, pullback, confirmation: confirmed,
    extensionAtr: Number.isFinite(extension) ? Math.round(extension * 100) / 100 : null,
    tickAgeSeconds: Math.round(tickAgeSeconds * 10) / 10
  };
  const evidence = [
    "M5 LIVE: ใช้แท่ง M5 ที่กำลังก่อตัวจาก M1 Streaming",
    `M5 bias: ${bias}`,
    `M1 pullback: ${pullback ? "ผ่าน" : "ยังไม่ผ่าน"}`,
    `M1 confirmation: ${confirmed ? "ผ่าน" : "ยังไม่ผ่าน"}`,
    `ระยะจาก EMA5: ${metrics.extensionAtr ?? "N/A"} ATR`,
    "ราคาปัจจุบันมาจาก Twelve Data Streaming"
  ];

  if (bias === "WAIT") {
    return standby("M5 ยังไม่มีทิศทางชัดเจน — รอข้อมูลสดเพิ่ม", {
      dataMode: "STREAMING", livePriceReady: true, metrics, evidence,
      regime: "UNCLEAR", m5Bias: bias
    });
  }
  if (alreadyUsed) {
    return standby("M5 รอบนี้ออกสัญญาณไปแล้ว — ป้องกันสัญญาณซ้ำ", {
      dataMode: "STREAMING", livePriceReady: true, metrics, evidence,
      m5Bias: bias, riskFlags: ["ONE_SIGNAL_PER_M5_BLOCK"]
    });
  }
  if (!pullback) {
    return standby("M5 มีทิศทางแล้ว — รอ M1 ย่อตัวกลับเข้าโซน EMA5", {
      dataMode: "STREAMING", livePriceReady: true, metrics, evidence,
      regime: bias === "CALL" ? "UPTREND" : "DOWNTREND", m5Bias: bias
    });
  }
  if (!confirmed) {
    return standby("M1 เกิด Pullback แล้ว — รอแท่งสดยืนยันทะลุ High/Low ก่อนหน้า", {
      dataMode: "STREAMING", livePriceReady: true, metrics, evidence,
      regime: bias === "CALL" ? "UPTREND" : "DOWNTREND", m5Bias: bias
    });
  }
  if (!notExtended) {
    return standby("ยกเลิกจังหวะ: ราคา M1 วิ่งห่าง EMA5 เกิน 1.4 ATR", {
      dataMode: "STREAMING", livePriceReady: true, metrics, evidence,
      regime: bias === "CALL" ? "UPTREND" : "DOWNTREND", m5Bias: bias,
      riskFlags: ["M1_ENTRY_OVEREXTENDED"]
    });
  }

  return {
    signal: bias, direction: bias, status: "SIGNAL", score: 85, confidence: 85,
    regime: bias === "CALL" ? "UPTREND" : "DOWNTREND",
    reason: `M5 LIVE ${bias} + M1 Pullback + Breakout confirmation ผ่าน`,
    summary: `M5 LIVE ${bias} + M1 Pullback + Breakout confirmation ผ่าน`,
    strategy: "M5_LIVE_DIRECTION_M1_PULLBACK_CONFIRMATION",
    provider: "TWELVE_DATA_LIVE_STREAM", dataMode: "STREAMING",
    livePriceReady: true, m5Bias: bias, m5BlockEpoch: currentM5.epoch,
    evidence, riskFlags: [], metrics,
    signalReleaseValidated: false,
    signalValidationStatus: "M5_M1_LIVE_MANUAL_ONLY_NOT_OOS_VALIDATED",
    signalValidationNote: "M5 forming direction + M1 live pullback/confirmation · ยังไม่มีผลทดสอบ out-of-sample · ใช้ paper/manual เท่านั้น"
  };
}

export { aggregateM5 };
