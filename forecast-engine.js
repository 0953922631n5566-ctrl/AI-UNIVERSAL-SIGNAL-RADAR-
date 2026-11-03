// Closed-candle-only EUR/USD M1 decision engine.
// A decision is calculated from completed candles and is valid for the immediately following M1 candle.
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
  const prevSignal = ema(valid.slice(0, -1), 9);
  return {
    histogram: valid.at(-1) - signal,
    previousHistogram: valid.at(-2) - prevSignal
  };
}
function standby(reason, lastClosedAt = null, nextCandleAt = null) {
  return { signal: 'STANDBY', agreementScore: 0, agreementVotes: '0/6',
    horizon: 1, lastClosedAt, nextCandleAt, validFor: 'NEXT_M1_ONLY', reason };
}
function evaluateNextCandle(closedCandles) {
  const candles = Array.isArray(closedCandles) ? closedCandles.slice(-220) : [];
  if (candles.length < 35) return standby('ต้องมีแท่ง M1 ที่ปิดแล้วอย่างน้อย 35 แท่ง');
  const closes = candles.map(c => Number(c.close));
  const last = candles.at(-1);
  if (!closes.every(Number.isFinite) || ![Number(last.open), Number(last.close)].every(Number.isFinite))
    return standby('ข้อมูลแท่งปิดไม่สมบูรณ์');
  const e5 = ema(closes, 5), e20 = ema(closes, 20);
  const e5Prev = ema(closes.slice(0, -1), 5), e20Prev = ema(closes.slice(0, -1), 20);
  const strength = rsi(closes, 14), m = macd(closes);
  if (![e5,e20,e5Prev,e20Prev,strength].every(Number.isFinite) || !m)
    return standby('คำนวณข้อมูลจากแท่งปิดไม่ครบ');
  const lastStart = Date.parse(String(last.datetime).replace(' ', 'T') + 'Z');
  const lastClosedAt = Number.isFinite(lastStart) ? new Date(lastStart + 60000).toISOString() : null;
  const nextCandleAt = lastClosedAt;
  const bodyUp = Number(last.close) > Number(last.open);
  const bodyDown = Number(last.close) < Number(last.open);
  const votesUp = [e5 > e20, e5 > e5Prev && e20 > e20Prev,
    m.histogram > 0, m.histogram > m.previousHistogram,
    strength >= 52 && strength <= 70, bodyUp];
  const votesDown = [e5 < e20, e5 < e5Prev && e20 < e20Prev,
    m.histogram < 0, m.histogram < m.previousHistogram,
    strength >= 30 && strength <= 48, bodyDown];
  const up = votesUp.filter(Boolean).length, down = votesDown.filter(Boolean).length;
  let signal = 'STANDBY', votes = 0;
  if (up >= 5 && up - down >= 3) { signal = 'CALL'; votes = up; }
  else if (down >= 5 && down - up >= 3) { signal = 'PUT'; votes = down; }
  else votes = Math.max(up, down);
  return {
    signal, agreementScore: Math.round(votes / 6 * 100), agreementVotes: votes + '/6',
    horizon: 1, lastClosedAt, nextCandleAt, validFor: 'NEXT_M1_ONLY',
    indicators: { ema5: Number(e5.toFixed(5)), ema20: Number(e20.toFixed(5)), rsi14: Number(strength.toFixed(1)),
      macdHistogram: Number(m.histogram.toFixed(8)) },
    reason: signal === 'STANDBY' ? 'แท่งปิดล่าสุดยังไม่ผ่านเกณฑ์ 5 ใน 6 ข้อ · STANDBY'
      : 'วิเคราะห์จากแท่ง M1 ที่ปิดแล้วเท่านั้น · ' + signal + ' สำหรับแท่ง M1 ถัดไป · ผ่าน ' + votes + '/6'
  };
}
module.exports = { evaluateNextCandle };
