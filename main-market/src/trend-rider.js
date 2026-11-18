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

/** Independent M1 trend-continuation engine; closed history plus optional provisional current-candle OHLC. */
export function analyzeTrendRider(candles, options = {}) {
  const minimum = Number.isInteger(options.minimumCandles) ? options.minimumCandles : 30;
  if (!Array.isArray(candles) || candles.length < minimum ||
      !candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
        c.low > 0 && c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close) && c.high >= c.low)) {
    return { ready: false, signal: null, score: 0, status: "NOT_READY",
      reason: "Trend Rider ต้องมีแท่ง M1 ปิดที่มี OHLC ถูกต้องอย่างน้อย 30 แท่ง",
      strategy: "EMA5_20_STRUCTURE_PULLBACK_CONTINUATION" };
  }
  const closes = candles.map(c => c.close);
  const fast = ema(closes, 5), slow = ema(closes, 20);
  const last = candles.at(-1), previous = candles.at(-2);
  const fastNow = fast.at(-1), slowNow = slow.at(-1);
  const fastBack = fast.at(-4), slowBack = slow.at(-4);
  const volatility = atr(candles);
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const bodyRatio = Math.abs(last.close - last.open) / range;
  const gapAtr = volatility > 0 ? Math.abs(fastNow - slowNow) / volatility : 0;
  const extensionAtr = volatility > 0 ? Math.abs(last.close - fastNow) / volatility : Infinity;
  const recent = candles.slice(-8, -1);
  const priorHigh = Math.max(...recent.map(c => c.high));
  const priorLow = Math.min(...recent.map(c => c.low));
  const risingStructure = last.close > slowNow &&
    candles.slice(-5).filter((c, i, rows) => i > 0 && c.low >= rows[i - 1].low).length >= 2;
  const fallingStructure = last.close < slowNow &&
    candles.slice(-5).filter((c, i, rows) => i > 0 && c.high <= rows[i - 1].high).length >= 2;
  const upAligned = fastNow > slowNow && fastNow > fastBack && slowNow >= slowBack;
  const downAligned = fastNow < slowNow && fastNow < fastBack && slowNow <= slowBack;
  const upPullback = last.low <= fastNow + volatility * 0.25 && last.close > fastNow && last.close >= last.open;
  const downPullback = last.high >= fastNow - volatility * 0.25 && last.close < fastNow && last.close <= last.open;
  const upBreak = last.close > priorHigh, downBreak = last.close < priorLow;
  const upMomentum = last.close > previous.close && bodyRatio >= 0.35;
  const downMomentum = last.close < previous.close && bodyRatio >= 0.35;
  const scoreUp = Math.round(30 * Number(upAligned) + 20 * clamp(gapAtr / 0.55) +
    20 * Number(risingStructure) + 15 * Number(upPullback || upBreak) + 15 * Number(upMomentum));
  const scoreDown = Math.round(30 * Number(downAligned) + 20 * clamp(gapAtr / 0.55) +
    20 * Number(fallingStructure) + 15 * Number(downPullback || downBreak) + 15 * Number(downMomentum));
  const sideways = gapAtr < 0.12, late = extensionAtr > 1.5;
  const volatilitySpike = volatility > 0 && range > volatility * 2.8;
  let signal = null, score = Math.max(scoreUp, scoreDown);
  let status = "TREND_NOT_CONFIRMED";
  let reason = "แนวโน้ม EMA5/20 และโครงสร้างราคาไม่สอดคล้องพอ";
  if (sideways) { status = "SIDEWAYS_BLOCK"; reason = "EMA5/20 พันกัน · งดไล่สัญญาณในตลาดออกข้าง"; }
  else if (late) { status = "LATE_ENTRY_BLOCK"; reason = "ราคาออกห่าง EMA5 เกิน 1.5 ATR · ไม่ไล่ตามเทรนด์ที่ยืดตัวแล้ว"; }
  else if (volatilitySpike) { status = "VOLATILITY_BLOCK"; reason = "แท่งล่าสุดมีช่วงกว้างผิดปกติเมื่อเทียบกับ ATR"; }
  else if (scoreUp >= 65 && scoreUp - scoreDown >= 12 && upAligned && (risingStructure || upBreak)) {
    signal = "CALL"; score = scoreUp; status = "UPTREND_CONTINUATION";
    reason = "EMA5 อยู่เหนือ EMA20 · โครงสร้างขาขึ้นยังอยู่ · มีแรงต่อเนื่องหรือย่อแล้วกลับขึ้น";
  } else if (scoreDown >= 65 && scoreDown - scoreUp >= 12 && downAligned && (fallingStructure || downBreak)) {
    signal = "PUT"; score = scoreDown; status = "DOWNTREND_CONTINUATION";
    reason = "EMA5 อยู่ใต้ EMA20 · โครงสร้างขาลงยังอยู่ · มีแรงต่อเนื่องหรือย่อแล้วกลับลง";
  } else if (score >= 45) { status = "TREND_WATCH"; reason = "เริ่มเห็นแนวโน้ม แต่หลักฐานต่อเนื่องยังไม่ครบ · เฝ้าดู"; }
  return {
    ready: true, signal, direction: signal, score, scoreUp, scoreDown, status, reason,
    strategy: "EMA5_20_STRUCTURE_PULLBACK_CONTINUATION",
    regime: upAligned ? "UPTREND" : downAligned ? "DOWNTREND" : "UNCLEAR",
    metrics: { ema5: fastNow, ema20: slowNow, emaGapAtr: Number(gapAtr.toFixed(3)),
      extensionAtr: Number(extensionAtr.toFixed(3)), atr: volatility, bodyRatio: Number(bodyRatio.toFixed(3)),
      priorHigh, priorLow },
    evidence: [
      upAligned || downAligned ? "EMA5/EMA20 alignment and slope agree" : "EMA alignment incomplete",
      risingStructure || fallingStructure ? "Recent swing structure supports trend" : "Swing structure not confirmed",
      upPullback || downPullback ? "Pullback reclaimed EMA5" : upBreak || downBreak ? "Recent structure breakout" : "No clean continuation trigger",
      sideways ? "Sideways guard active" : late ? "Late-extension guard active" : "No late-entry guard"
    ]
  };
}
