// User-approved Forex formula: EMA(5/20), Bollinger Bandwidth(20,2), RSI(14).
// This module consumes real closed M1 candles plus the latest live WebSocket quote.
// It contains no synthetic prices, MACD, six-vote scoring, or legacy trend filters.
function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) return prices?.[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateBB(prices, period = 20, mult = 2) {
  if (!Array.isArray(prices) || prices.length < period) return { bandwidth: 1 };
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + mult * stdDev;
  const lower = sma - mult * stdDev;
  return { upper, middle: sma, lower, bandwidth: sma ? ((upper - lower) / sma) * 100 : 1 };
}

function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function evaluateLiveFormula(closedCandles, currentPrice, previousPrice, now = Date.now()) {
  const closes = (Array.isArray(closedCandles) ? closedCandles : [])
    .map(c => Number(c.close)).filter(Number.isFinite).slice(-119);
  if (closes.length < 20 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { ready: false, signal: 'WAIT', statusText: 'WAIT', statusColor: 'green',
      confidence: 50, rsi: 50, trend: 'NEUTRAL', reason: 'รอแท่ง M1 จริงอย่างน้อย 20 แท่ง' };
  }
  const prices = closes.concat(currentPrice);
  const prevPrice = Number.isFinite(previousPrice) ? previousPrice : closes.at(-1);
  const rsi = Number(calculateRSI(prices).toFixed(1));
  const ema5 = calculateEMA(prices, 5);
  const ema20 = calculateEMA(prices, 20);
  const bb = calculateBB(prices);
  const isBullishTrend = ema5 > ema20 && currentPrice >= ema5;
  const isBearishTrend = ema5 < ema20 && currentPrice <= ema5;
  const isSideway = bb.bandwidth < 0.04;
  let score = 65;
  if (isBullishTrend || isBearishTrend) score += 20;
  if (currentPrice !== prevPrice) score += 10;
  const confidence = Math.min(score, 96).toFixed(1);
  const d = new Date(now);
  const exactTimeLeft = 60 - (d.getSeconds() + d.getMilliseconds() / 1000);
  const trend = isBullishTrend ? 'BULLISH' : isBearishTrend ? 'BEARISH' : 'NEUTRAL';
  return {
    ready: true, signal: 'WAIT',
    candidate: isBullishTrend && score >= 58 ? 'CALL'
      : isBearishTrend && score >= 58 ? 'PUT' : 'WAIT',
    statusText: isSideway ? 'DANGER' : 'SAFE',
    statusColor: isSideway ? 'red' : 'green',
    confidence, rsi, ema5, ema20, bandwidth: bb.bandwidth,
    trend, trendLabel: isBullishTrend ? 'ขาขึ้น' : isBearishTrend ? 'ขาลง' : 'เป็นกลาง',
    isBullishTrend, isBearishTrend, isSideway, exactTimeLeft,
    currentPrice, previousPrice: prevPrice,
    reason: isSideway ? 'Bollinger Bandwidth ต่ำกว่า 0.04% · SIDEWAY · STANDBY'
      : isBullishTrend ? 'EMA5 อยู่เหนือ EMA20 และราคายืนเหนือ EMA5 · ตามเทรนด์ขาขึ้น'
      : isBearishTrend ? 'EMA5 อยู่ใต้ EMA20 และราคาอยู่ใต้ EMA5 · ตามเทรนด์ขาลง'
      : 'แนวโน้มยังไม่ชัด · รอองค์ประกอบครบ · STANDBY'
  };
}

module.exports = { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula };
