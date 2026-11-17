const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function ema(values, period) {
  if (values.length < period) return [];
  const alpha = 2 / (period + 1);
  let value = mean(values.slice(0, period));
  const result = Array(period - 1).fill(null);
  result.push(value);
  for (let i = period; i < values.length; i++) {
    value = values[i] * alpha + value * (1 - alpha);
    result.push(value);
  }
  return result;
}

function atr(candles, period = 14) {
  const ranges = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low - candles[i].close)
  ));
  return mean(ranges.slice(-period));
}

function validClosedCandle(candle) {
  return candle && candle.live !== true &&
    [candle.epoch, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.epoch >= 0 && candle.low > 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low;
}

/**
 * Engine 4 is an isolated, stricter copy of Engine 3 (Trend Rider AI).
 * It uses closed M1 candles only and never reads another engine's score.
 */
export function analyzeStrictTrendRider(candles, options = {}) {
  const minimum = Number.isInteger(options.minimumCandles) ? options.minimumCandles : 35;
  const source = Array.isArray(candles) ? candles.slice(-54) : [];
  if (source.length < minimum || !source.every(validClosedCandle)) {
    return { ready: false, signal: null, candidateSignal: null, score: 0, status: "NOT_READY",
      reason: `Engine 4 ต้องมีแท่ง M1 ปิดที่ถูกต้องอย่างน้อย ${minimum} แท่ง`,
      strategy: "STRICT_COPY_OF_TREND_RIDER_EMA5_20_STRUCTURE_PULLBACK" };
  }

  const closes = source.map(c => c.close);
  const fast = ema(closes, 5), slow = ema(closes, 20);
  const last = source.at(-1), previous = source.at(-2);
  const fastNow = fast.at(-1), slowNow = slow.at(-1);
  const fastBack = fast.at(-4), slowBack = slow.at(-4);
  const volatility = atr(source);
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const bodyRatio = Math.abs(last.close - last.open) / range;
  const gapAtr = volatility > 0 ? Math.abs(fastNow - slowNow) / volatility : 0;
  const extensionAtr = volatility > 0 ? Math.abs(last.close - fastNow) / volatility : Infinity;
  const recent = source.slice(-8, -1);
  const priorHigh = Math.max(...recent.map(c => c.high));
  const priorLow = Math.min(...recent.map(c => c.low));
  const risingStructure = last.close > slowNow &&
    source.slice(-5).filter((c, i, rows) => i > 0 && c.low >= rows[i - 1].low).length >= 2;
  const fallingStructure = last.close < slowNow &&
    source.slice(-5).filter((c, i, rows) => i > 0 && c.high <= rows[i - 1].high).length >= 2;
  const upAligned = fastNow > slowNow && fastNow > fastBack && slowNow >= slowBack;
  const downAligned = fastNow < slowNow && fastNow < fastBack && slowNow <= slowBack;
  const upPullback = last.low <= fastNow + volatility * 0.18 && last.close > fastNow && last.close >= last.open;
  const downPullback = last.high >= fastNow - volatility * 0.18 && last.close < fastNow && last.close <= last.open;
  const upBreak = last.close > priorHigh, downBreak = last.close < priorLow;
  const upMomentum = last.close > previous.close && bodyRatio >= 0.45;
  const downMomentum = last.close < previous.close && bodyRatio >= 0.45;

  const scoreUp = Math.round(30 * Number(upAligned) + 20 * clamp(gapAtr / 0.55) +
    20 * Number(risingStructure) + 15 * Number(upPullback || upBreak) + 15 * Number(upMomentum));
  const scoreDown = Math.round(30 * Number(downAligned) + 20 * clamp(gapAtr / 0.55) +
    20 * Number(fallingStructure) + 15 * Number(downPullback || downBreak) + 15 * Number(downMomentum));

  // Tighter than Engine 3: stronger trend separation and stricter market guards.
  const sideways = gapAtr < 0.18;
  const late = extensionAtr > 1.25;
  const volatilitySpike = volatility > 0 && range > volatility * 2.3;
  const score = Math.max(scoreUp, scoreDown);
  const candleEpoch = last.epoch;
  const base = {
    ready: true, signal: null, candidateSignal: null, score, scoreUp, scoreDown,
    candleEpoch, targetCandleAt: new Date((candleEpoch + 120) * 1000).toISOString(),
    strategy: "STRICT_COPY_OF_TREND_RIDER_EMA5_20_STRUCTURE_PULLBACK",
    regime: upAligned ? "UPTREND" : downAligned ? "DOWNTREND" : "UNCLEAR",
    metrics: { ema5: fastNow, ema20: slowNow, emaGapAtr: Number(gapAtr.toFixed(3)),
      extensionAtr: Number(extensionAtr.toFixed(3)), atr: volatility,
      bodyRatio: Number(bodyRatio.toFixed(3)), priorHigh, priorLow },
    evidence: [
      upAligned || downAligned ? "EMA5/EMA20 alignment and slope agree" : "EMA alignment incomplete",
      risingStructure || fallingStructure ? "Recent swing structure supports trend" : "Swing structure not confirmed",
      upPullback || downPullback ? "Pullback reclaimed EMA5" : upBreak || downBreak ? "Recent structure breakout" : "No clean continuation trigger",
      sideways ? "Strict sideways guard active" : late ? "Strict late-extension guard active" :
        volatilitySpike ? "Strict abnormal-range guard active" : "Market guards passed"
    ]
  };

  if (sideways) return { ...base, status: "SIDEWAYS_BLOCK",
    reason: "EMA5/EMA20 ยังใกล้กันเกินไป · งดสัญญาณในตลาด Sideway" };
  if (late) return { ...base, status: "LATE_ENTRY_BLOCK",
    reason: "ราคาออกห่าง EMA5 เกิน 1.25 ATR · ไม่ไล่ตามราคา" };
  if (volatilitySpike) return { ...base, status: "VOLATILITY_BLOCK",
    reason: "แท่งล่าสุดกว้างเกิน 2.3 ATR · รอความผันผวนลดลง" };

  if (scoreUp >= 75 && scoreUp - scoreDown >= 18 && upAligned &&
      (risingStructure || upBreak) && (upPullback || upBreak) && upMomentum) {
    return { ...base, signal: "CALL", candidateSignal: "CALL", score: scoreUp,
      status: "STRICT_UPTREND_CONFIRMED",
      alertId: `ENGINE_4:${candleEpoch}:CALL`,
      reason: "ยืนยัน CALL · EMA5/20 ไปทางเดียวกัน · โครงสร้างขาขึ้นชัด · มี Pullback/Breakout และแท่งยืนยันแรงซื้อ" };
  }
  if (scoreDown >= 75 && scoreDown - scoreUp >= 18 && downAligned &&
      (fallingStructure || downBreak) && (downPullback || downBreak) && downMomentum) {
    return { ...base, signal: "PUT", candidateSignal: "PUT", score: scoreDown,
      status: "STRICT_DOWNTREND_CONFIRMED",
      alertId: `ENGINE_4:${candleEpoch}:PUT`,
      reason: "ยืนยัน PUT · EMA5/20 ไปทางเดียวกัน · โครงสร้างขาลงชัด · มี Pullback/Breakdown และแท่งยืนยันแรงขาย" };
  }

  return { ...base, status: score >= 55 ? "STRICT_TREND_WATCH" : "STRICT_SCORE_BLOCK",
    reason: score >= 55
      ? "เริ่มมีแนวโน้ม แต่คะแนน/โครงสร้าง/แรงแท่งยังไม่ครบเกณฑ์เข้มงวด"
      : `คะแนนทิศทาง ${score}/100 ยังต่ำกว่าเกณฑ์ 75/100` };
}
