// Two-horizon EUR/USD M1 forecast. Scores are rule-agreement scores, NOT probabilities.
function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(values) {
  if (values.length < 35) return null;
  const line = [];
  for (let i = 0; i < values.length; i++) {
    const sample = values.slice(0, i + 1);
    const fast = ema(sample, 12), slow = ema(sample, 26);
    line.push(fast === null || slow === null ? null : fast - slow);
  }
  const valid = line.filter(Number.isFinite);
  if (valid.length < 10) return null;
  const signal = ema(valid, 9);
  const previousSignal = ema(valid.slice(0, -1), 9);
  const histogram = valid[valid.length - 1] - signal;
  const previousHistogram = valid.length > 1 && previousSignal !== null
    ? valid[valid.length - 2] - previousSignal : null;
  return { histogram, previousHistogram };
}

function result(votes, direction, horizon, reason) {
  const agree = votes.filter(Boolean).length;
  const oppose = votes.filter(v => v === false).length;
  const signal = agree >= 5 && agree - oppose >= 3 ? direction : 'STANDBY';
  return {
    signal,
    agreementScore: Math.round((agree / votes.length) * 100),
    agreementVotes: agree + '/' + votes.length,
    horizon,
    reason: signal === 'STANDBY'
      ? reason + ' · เกณฑ์ผ่านอย่างน้อย 5 ใน 6 ข้อ'
      : reason + ' · ผ่าน ' + agree + '/6 ตัวกรอง'
  };
}

function evaluateNextCandle(closedCandles, livePrice, momentum) {
  const candles = Array.isArray(closedCandles) ? closedCandles.slice(-220) : [];
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  const last = candles[candles.length - 1];
  const values = closes.concat(Number(livePrice));
  const standby = reason => ({
    signal: 'STANDBY', agreementScore: 0, agreementVotes: '0/6',
    horizon: 1, reason
  });
  if (candles.length < 35 || !Number.isFinite(Number(livePrice)) || !last) {
    return standby('ข้อมูลย้อนหลังไม่ครบ 35 แท่ง');
  }

  const ema5 = ema(values, 5), ema20 = ema(values, 20);
  const ema5Prev = ema(values.slice(0, -1), 5);
  const ema20Prev = ema(values.slice(0, -1), 20);
  const strength = rsi(values, 14);
  const m = macd(values);
  if (![ema5, ema20, ema5Prev, ema20Prev, strength].every(Number.isFinite) || !m) {
    return standby('คำนวณอินดิเคเตอร์ไม่ครบ');
  }

  const bullish = ema5 > ema20;
  const bearish = ema5 < ema20;
  const fastUp = ema5 > ema5Prev && ema20 > ema20Prev;
  const fastDown = ema5 < ema5Prev && ema20 < ema20Prev;
  const macdUp = m.histogram > 0 && (m.previousHistogram === null || m.histogram >= m.previousHistogram);
  const macdDown = m.histogram < 0 && (m.previousHistogram === null || m.histogram <= m.previousHistogram);
  const rsiUp = strength >= 52 && strength <= 70;
  const rsiDown = strength >= 30 && strength <= 48;
  const bodyUp = Number(last.close) > Number(last.open);
  const bodyDown = Number(last.close) < Number(last.open);
  const momentumUp = Number.isFinite(momentum) && momentum > 0.000005;
  const momentumDown = Number.isFinite(momentum) && momentum < -0.000005;

  if (bullish) return result(
    [bullish, fastUp, macdUp, rsiUp, bodyUp, momentumUp],
    'CALL', 1, 'แท่ง M1 ถัดไป: EMA5/20, MACD, RSI, แท่งปิด และ Momentum'
  );
  if (bearish) return result(
    [bearish, fastDown, macdDown, rsiDown, bodyDown, momentumDown],
    'PUT', 1, 'แท่ง M1 ถัดไป: EMA5/20, MACD, RSI, แท่งปิด และ Momentum'
  );
  return standby('EMA5/EMA20 ยังไม่แยกทิศทาง');
}

module.exports = { evaluateNextCandle };
