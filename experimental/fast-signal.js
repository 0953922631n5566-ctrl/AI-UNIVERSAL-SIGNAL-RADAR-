'use strict';

// Experimental high-frequency directional scoring for EUR/USD M1.
// Uses only candles supplied up to the latest CLOSED candle.
// Score is a rule score, NOT a probability of winning.

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  for (let i = period; i < values.length; i++) value = alpha * values[i] + (1 - alpha) * value;
  return value;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  const out = Array(period - 1).fill(null);
  out.push(value);
  for (let i = period; i < values.length; i++) {
    value = alpha * values[i] + (1 - alpha) * value;
    out.push(value);
  }
  return out;
}

function rsi(values, period = 5) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    gains += Math.max(d, 0);
    losses += Math.max(-d, 0);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  if (trs.length < period) return null;
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) value = (value * (period - 1) + trs[i]) / period;
  return value;
}

function macdHistogram(closes) {
  if (closes.length < 17) return null;
  const fast = emaSeries(closes, 5);
  const slow = emaSeries(closes, 13);
  const line = closes.map((_, i) => fast[i] == null || slow[i] == null ? null : fast[i] - slow[i]);
  const valid = line.filter(Number.isFinite);
  if (valid.length < 4) return null;
  const signal = ema(valid, 4);
  return valid[valid.length - 1] - signal;
}

function normalizeCandles(input) {
  if (!Array.isArray(input)) throw new TypeError('candles must be an array');
  const candles = input.map(c => ({
    datetime: String(c.datetime || ''),
    open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close)
  }));
  for (const c of candles) {
    if (![c.open, c.high, c.low, c.close].every(Number.isFinite) ||
        c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) ||
        c.high < c.low) throw new TypeError('invalid OHLC candle');
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].datetime && candles[i - 1].datetime &&
        candles[i].datetime <= candles[i - 1].datetime) {
      throw new TypeError('candles must be strictly chronological and unique');
    }
  }
  return candles;
}

function analyzeFastSignal(input, options = {}) {
  const candles = normalizeCandles(input);
  const minCandles = options.minCandles || 25;
  const threshold = options.threshold == null ? 55 : options.threshold;
  const minEdge = options.minEdge == null ? 15 : options.minEdge;
  if (candles.length < minCandles) {
    return { signal: 'STANDBY', reason: 'ข้อมูลยังไม่พอ', candlesUsed: candles.length,
      requiredCandles: minCandles, callScore: 0, putScore: 0, scoreType: 'rule-score' };
  }

  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const ema3 = ema(closes, 3);
  const ema8 = ema(closes, 8);
  const rsi5 = rsi(closes, 5);
  const atr14 = atr(candles, 14);
  const macdHist = macdHistogram(closes);
  const roc3 = closes[closes.length - 1] - closes[closes.length - 4];
  const rocAtr = atr14 > 0 ? roc3 / atr14 : 0;

  let callScore = 0, putScore = 0;
  const callReasons = [], putReasons = [];
  if (ema3 > ema8) { callScore += 20; callReasons.push('EMA3 เหนือ EMA8'); }
  else if (ema3 < ema8) { putScore += 20; putReasons.push('EMA3 ต่ำกว่า EMA8'); }

  if (last.close > ema3) { callScore += 10; callReasons.push('ราคายืนเหนือ EMA3'); }
  else if (last.close < ema3) { putScore += 10; putReasons.push('ราคาต่ำกว่า EMA3'); }

  if (rsi5 >= 52 && rsi5 < 78) { callScore += 15; callReasons.push('RSI5 โมเมนตัมบวก'); }
  else if (rsi5 <= 48 && rsi5 > 22) { putScore += 15; putReasons.push('RSI5 โมเมนตัมลบ'); }

  if (rocAtr >= 0.08) { callScore += 20; callReasons.push('Momentum 3 แท่งเป็นบวก'); }
  else if (rocAtr <= -0.08) { putScore += 20; putReasons.push('Momentum 3 แท่งเป็นลบ'); }

  if (macdHist > 0) { callScore += 15; callReasons.push('MACD histogram บวก'); }
  else if (macdHist < 0) { putScore += 15; putReasons.push('MACD histogram ลบ'); }

  const range = Math.max(last.high - last.low, 1e-12);
  const bodyRatio = Math.abs(last.close - last.open) / range;
  if (last.close > last.open && bodyRatio >= 0.25) {
    callScore += 10; callReasons.push('แท่งล่าสุดปิดบวก');
  } else if (last.close < last.open && bodyRatio >= 0.25) {
    putScore += 10; putReasons.push('แท่งล่าสุดปิดลบ');
  }

  if (last.close > prev.close) { callScore += 10; callReasons.push('ปิดสูงกว่าแท่งก่อน'); }
  else if (last.close < prev.close) { putScore += 10; putReasons.push('ปิดต่ำกว่าแท่งก่อน'); }

  let signal = 'STANDBY';
  if (callScore >= threshold && callScore - putScore >= minEdge) signal = 'CALL';
  else if (putScore >= threshold && putScore - callScore >= minEdge) signal = 'PUT';

  return {
    symbol: 'EUR/USD', timeframe: '1min', signal,
    callScore, putScore, scoreType: 'rule-score-not-probability',
    threshold, minEdge, rsi5: Number(rsi5.toFixed(2)),
    ema3: Number(ema3.toFixed(6)), ema8: Number(ema8.toFixed(6)),
    macdHistogram: Number(macdHist.toFixed(8)),
    momentumAtr: Number(rocAtr.toFixed(3)),
    atr14: Number(atr14.toFixed(6)),
    datetime: last.datetime, price: last.close,
    reasons: signal === 'CALL' ? callReasons : signal === 'PUT' ? putReasons : [],
    reason: signal === 'STANDBY' ? 'คะแนนหรือส่วนต่างคะแนนยังไม่ผ่านเกณฑ์' :
      (signal === 'CALL' ? 'แรงซื้อระยะสั้น' : 'แรงขายระยะสั้น') + ' ผ่านเกณฑ์คะแนน',
    candlesUsed: candles.length
  };
}

// A signal is evaluated at candle i close. Entry is next candle open;
// outcome is that next candle close vs its open. No future candle is used
// to calculate the signal itself. Spread, slippage and payout are not modeled.
function backtestFastSignal(input, options = {}) {
  const candles = normalizeCandles(input);
  const warmup = options.warmup || 25;
  const outcomes = [];
  for (let i = warmup - 1; i < candles.length - 1; i++) {
    const result = analyzeFastSignal(candles.slice(0, i + 1), options);
    if (result.signal === 'STANDBY') continue;
    const next = candles[i + 1];
    const win = result.signal === 'CALL' ? next.close > next.open :
      next.close < next.open;
    const flat = next.close === next.open;
    outcomes.push({ datetime: candles[i].datetime, signal: result.signal,
      score: result.signal === 'CALL' ? result.callScore : result.putScore,
      entry: next.open, exit: next.close, outcome: flat ? 'FLAT' : win ? 'WIN' : 'LOSS' });
  }
  const wins = outcomes.filter(x => x.outcome === 'WIN').length;
  const losses = outcomes.filter(x => x.outcome === 'LOSS').length;
  const flats = outcomes.filter(x => x.outcome === 'FLAT').length;
  const decisive = wins + losses;
  return {
    signals: outcomes.length, wins, losses, flats,
    winRateExcludingFlat: decisive ? Number((wins / decisive * 100).toFixed(2)) : null,
    winRateIncludingFlatAsNonWin: outcomes.length ?
      Number((wins / outcomes.length * 100).toFixed(2)) : null,
    note: 'ผลทดสอบแท่งถัดไปเท่านั้น; ยังไม่หัก spread/slippage และไม่ใช่ผลกำไรจริง',
    outcomes
  };
}

module.exports = { analyzeFastSignal, backtestFastSignal };
