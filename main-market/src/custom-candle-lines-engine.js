// Custom Candle Lines engine.
// All decision levels are derived directly from real M1 OHLC geometry.
// No EMA, RSI, MACD, Bollinger Bands, ATR, or broker-supplied indicators.

export const CANDLE_LINES_STRATEGY_ID = "EURUSD_CUSTOM_CANDLE_LINES_M1";
const MIN_HISTORY = 20;
const LOOKBACK = 8;
const PIP = 0.0001;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validCandle(candle) {
  return candle && [candle.open, candle.high, candle.low, candle.close]
    .every(value => Number.isFinite(Number(value))) &&
    Number(candle.high) >= Math.max(Number(candle.open), Number(candle.close)) &&
    Number(candle.low) <= Math.min(Number(candle.open), Number(candle.close));
}

function findConfirmedPivots(candles) {
  const highs = [], lows = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const previous = candles[i - 1], current = candles[i], next = candles[i + 1];
    if (current.high >= previous.high && current.high > next.high) {
      highs.push({ price: current.high, epoch: current.epoch });
    }
    if (current.low <= previous.low && current.low < next.low) {
      lows.push({ price: current.low, epoch: current.epoch });
    }
  }
  return { highs, lows };
}

function projectTrendLine(points, targetEpoch) {
  if (points.length < 2) return null;
  const first = points.at(-2), last = points.at(-1);
  const elapsed = last.epoch - first.epoch;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  const slopePerSecond = (last.price - first.price) / elapsed;
  const projected = last.price + slopePerSecond * (targetEpoch - last.epoch);
  return Number.isFinite(projected) ? projected : null;
}

function nearestLine(levels, price, direction, fallback) {
  const candidates = levels.map(item => item.price)
    .filter(level => direction === "below" ? level <= price : level >= price)
    .sort((a, b) => direction === "below" ? b - a : a - b);
  return candidates[0] ?? fallback;
}

function scoreCandidate(parts) {
  return Object.values(parts).reduce((sum, value) => sum + (value ? value : 0), 0);
}

export function analyzeCandleLines({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  const wait = (reason, extra = {}) => ({
    signal: "WAIT",
    regime: "NO_LINE_TRIGGER",
    reason,
    strategy: CANDLE_LINES_STRATEGY_ID,
    score: 0,
    callScore: 0,
    putScore: 0,
    threshold: 80,
    lineStatus: "WAITING",
    ...extra
  });

  if (symbol !== "EUR/USD") return wait("ระบบเส้นดักจับนี้รองรับเฉพาะ EUR/USD");
  if (!liveCandle || liveCandle.live !== true) return wait("รอแท่ง M1 ปัจจุบัน");
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) {
    return wait("ราคา Streaming ไม่สดเกิน 5 วินาที");
  }

  const closed = [...(closedCandles || [])]
    .filter(candle => candle && candle.live !== true && Number.isFinite(candle.epoch))
    .sort((a, b) => a.epoch - b.epoch);
  if (closed.length < MIN_HISTORY) {
    return wait(`ประวัติแท่งปิดไม่พอ (${closed.length}/${MIN_HISTORY})`);
  }
  if (!closed.every(validCandle) || !validCandle(liveCandle)) {
    return wait("ข้อมูล OHLC ไม่สมบูรณ์");
  }

  const recent = closed.slice(-LOOKBACK);
  const pivots = findConfirmedPivots(closed.slice(-Math.min(closed.length, 16)));
  const price = Number(liveCandle.close);
  const support = nearestLine(pivots.lows, price, "below", Math.min(...recent.map(c => c.low)));
  const resistance = nearestLine(pivots.highs, price, "above", Math.max(...recent.map(c => c.high)));
  const risingOrFallingSupportLine = projectTrendLine(pivots.lows, liveCandle.epoch);
  const risingOrFallingResistanceLine = projectTrendLine(pivots.highs, liveCandle.epoch);
  const microHigh = Math.max(...recent.map(c => c.high));
  const microLow = Math.min(...recent.map(c => c.low));
  const center = (microHigh + microLow) / 2;
  const ranges = recent.map(c => c.high - c.low);
  const bodies = recent.map(c => Math.abs(c.close - c.open));
  const medianRange = median(ranges);
  const medianBody = median(bodies);
  const buffer = Math.max(medianRange * 0.08, PIP * 0.15);

  const candle = liveCandle;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const span = Math.max(candle.high - candle.low, PIP * 0.05);
  const closePosition = clamp((candle.close - candle.low) / span, 0, 1);
  const bullish = candle.close > candle.open;
  const bearish = candle.close < candle.open;

  const upperTrigger = microHigh + buffer;
  const lowerTrigger = microLow - buffer;

  const lowerSweep = candle.low < support - buffer &&
    candle.close > support &&
    lowerWick >= Math.max(body * 1.15, medianRange * 0.12) &&
    closePosition >= 0.58;
  const upperSweep = candle.high > resistance + buffer &&
    candle.close < resistance &&
    upperWick >= Math.max(body * 1.15, medianRange * 0.12) &&
    closePosition <= 0.42;

  const bullishBreakout = candle.close > upperTrigger &&
    bullish && body >= Math.max(medianBody * 0.65, PIP * 0.1) &&
    closePosition >= 0.78;
  const bearishBreakout = candle.close < lowerTrigger &&
    bearish && body >= Math.max(medianBody * 0.65, PIP * 0.1) &&
    closePosition <= 0.22;

  const bullishTrendlineBreak = Number.isFinite(risingOrFallingResistanceLine) &&
    candle.close > risingOrFallingResistanceLine + buffer && bullish &&
    closePosition >= 0.78 && body >= Math.max(medianBody * 0.65, PIP * 0.1);
  const bearishTrendlineBreak = Number.isFinite(risingOrFallingSupportLine) &&
    candle.close < risingOrFallingSupportLine - buffer && bearish &&
    closePosition <= 0.22 && body >= Math.max(medianBody * 0.65, PIP * 0.1);

  const bullishRetest = candle.low <= resistance + buffer &&
    candle.low >= resistance - buffer * 2 &&
    candle.close > resistance + buffer * 0.2 &&
    bullish && closePosition >= 0.68;
  const bearishRetest = candle.high >= support - buffer &&
    candle.high <= support + buffer * 2 &&
    candle.close < support - buffer * 0.2 &&
    bearish && closePosition <= 0.32;

  const previous = closed.at(-1);
  const previousBodyHigh = Math.max(previous.open, previous.close);
  const previousBodyLow = Math.min(previous.open, previous.close);
  const bullishEngulf = bullish && candle.open <= previousBodyLow &&
    candle.close >= previousBodyHigh && closePosition >= 0.72 &&
    candle.close > microHigh;
  const bearishEngulf = bearish && candle.open >= previousBodyHigh &&
    candle.close <= previousBodyLow && closePosition <= 0.28 &&
    candle.close < microLow;

  const callSetup = lowerSweep || bullishBreakout || bullishRetest || bullishEngulf || bullishTrendlineBreak;
  const putSetup = upperSweep || bearishBreakout || bearishRetest || bearishEngulf || bearishTrendlineBreak;

  const callParts = {
    lineEvent: callSetup ? 50 : 0,
    candleBody: bullish && body >= medianBody * 0.65 ? 15 : 0,
    closeLocation: closePosition >= 0.78 ? 20 : closePosition >= 0.68 ? 15 : 0,
    wickRejection: lowerSweep || (upperWick <= Math.max(body * 0.35, buffer * 0.5) &&
      (bullishBreakout || bullishTrendlineBreak)) ? 15 : 0
  };
  const putParts = {
    lineEvent: putSetup ? 50 : 0,
    candleBody: bearish && body >= medianBody * 0.65 ? 15 : 0,
    closeLocation: closePosition <= 0.22 ? 20 : closePosition <= 0.32 ? 15 : 0,
    wickRejection: upperSweep || (lowerWick <= Math.max(body * 0.35, buffer * 0.5) &&
      (bearishBreakout || bearishTrendlineBreak)) ? 15 : 0
  };
  const callScore = callSetup ? scoreCandidate(callParts) : 0;
  const putScore = putSetup ? scoreCandidate(putParts) : 0;

  const lines = {
    support: Number(support.toFixed(5)),
    resistance: Number(resistance.toFixed(5)),
    microHigh: Number(microHigh.toFixed(5)),
    microLow: Number(microLow.toFixed(5)),
    center: Number(center.toFixed(5)),
    upperTrigger: Number(upperTrigger.toFixed(5)),
    lowerTrigger: Number(lowerTrigger.toFixed(5)),
    supportTrend: Number.isFinite(risingOrFallingSupportLine) ? Number(risingOrFallingSupportLine.toFixed(5)) : null,
    resistanceTrend: Number.isFinite(risingOrFallingResistanceLine) ? Number(risingOrFallingResistanceLine.toFixed(5)) : null,
    bufferPips: Number((buffer / PIP).toFixed(2))
  };
  const common = {
    strategy: CANDLE_LINES_STRATEGY_ID,
    threshold: 80,
    score: Math.max(callScore, putScore),
    callScore,
    putScore,
    scoreParts: { call: callParts, put: putParts },
    lines,
    candleShape: {
      bodyPips: Number((body / PIP).toFixed(2)),
      upperWickPips: Number((upperWick / PIP).toFixed(2)),
      lowerWickPips: Number((lowerWick / PIP).toFixed(2)),
      closePosition: Number(closePosition.toFixed(3))
    },
    lineEvents: {
      lowerSweep, upperSweep, bullishBreakout, bearishBreakout,
      bullishRetest, bearishRetest, bullishEngulf, bearishEngulf,
      bullishTrendlineBreak, bearishTrendlineBreak
    },
    sourceCandleEpoch: candle.epoch,
    targetCandleEpoch: candle.epoch + 60,
    tickAgeSeconds: Number(tickAgeSeconds.toFixed(2)),
    source: "Twelve Data real M1 OHLC + custom candle geometry lines",
    indicatorSource: "NONE · custom price lines only"
  };

  if (callScore >= 80 && putScore >= 80) {
    return { ...common, signal: "WAIT", regime: "CONFLICTING_LINE_EVENTS",
      lineStatus: "CONFLICT", reason: "เส้นดักจับให้สัญญาณสองทิศทางพร้อมกัน · งดเข้าออเดอร์" };
  }
  if (callScore >= 80) {
    const setup = lowerSweep ? "กวาดแนวรับแล้วดึงกลับ" :
      bullishBreakout ? "ทะลุเส้น Trigger ด้านบน" :
      bullishRetest ? "ทดสอบเส้นต้านเดิมแล้วผ่านขึ้น" :
      bullishTrendlineBreak ? "ทะลุเส้นแนวโน้มขาลงที่คำนวณเอง" : "แท่งกลืนกินทะลุกรอบบน";
    return { ...common, signal: "CALL", regime: "CUSTOM_LINE_CALL",
      lineStatus: "CALL_TRIGGERED", reason: `${setup} · คะแนนโครงสร้างแท่ง ${callScore}/100 · สำหรับแท่ง M1 ถัดไป` };
  }
  if (putScore >= 80) {
    const setup = upperSweep ? "กวาดแนวต้านแล้วถูกกดกลับ" :
      bearishBreakout ? "หลุดเส้น Trigger ด้านล่าง" :
      bearishRetest ? "ทดสอบแนวรับเดิมแล้วผ่านลง" :
      bearishTrendlineBreak ? "หลุดเส้นแนวโน้มขาขึ้นที่คำนวณเอง" : "แท่งกลืนกินทะลุกรอบล่าง";
    return { ...common, signal: "PUT", regime: "CUSTOM_LINE_PUT",
      lineStatus: "PUT_TRIGGERED", reason: `${setup} · คะแนนโครงสร้างแท่ง ${putScore}/100 · สำหรับแท่ง M1 ถัดไป` };
  }

  return { ...common, signal: "WAIT", regime: "LINES_NOT_CONFIRMED",
    lineStatus: "LINES_ARMED",
    reason: `เส้นพร้อมดักจับ · CALL ${callScore}/100 · PUT ${putScore}/100 · ยังไม่เกิดเหตุการณ์ยืนยันเส้น` };
}

export const CANDLE_LINES_MIN_HISTORY = MIN_HISTORY;
