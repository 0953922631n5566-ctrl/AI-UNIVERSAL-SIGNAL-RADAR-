// Real-data multi-regime M1 analysis: trend following, range breakout, and sideway protection.
// No synthetic prices and no forced CALL/PUT fallback.
function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateBB(prices, period = 20, mult = 2) {
  if (!Array.isArray(prices) || prices.length < period) return { bandwidth: null };
  const values = prices.slice(-period);
  const middle = values.reduce((sum, value) => sum + value, 0) / period;
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
  const deviation = Math.sqrt(variance);
  const upper = middle + mult * deviation;
  const lower = middle - mult * deviation;
  return { upper, middle, lower, bandwidth: middle ? ((upper - lower) / middle) * 100 : null };
}

function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function evaluateLiveFormula(closedCandles, currentPrice, previousPrice, now = Date.now()) {
  const candles = (Array.isArray(closedCandles) ? closedCandles : [])
    .filter(c => c && Number.isFinite(Number(c.close)))
    .slice(-120);
  const closes = candles.map(c => Number(c.close));
  if (closes.length < 20 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      ready: false, signal: 'WAIT', candidate: 'WAIT', regime: 'WAITING FOR DATA',
      statusText: 'DANGER', statusColor: 'red', confidence: '50.0', rsi: null,
      trend: 'NEUTRAL', trendLabel: 'รอข้อมูล', reason: 'ต้องมีแท่ง M1 จริงอย่างน้อย 20 แท่งและราคาสด'
    };
  }

  const prices = closes.concat(currentPrice);
  const prevPrice = Number.isFinite(previousPrice) ? previousPrice : closes[closes.length - 1];
  const ema5 = calculateEMA(prices, 5);
  const ema20 = calculateEMA(prices, 20);
  const rsi = calculateRSI(prices, 14);
  const bb = calculateBB(prices, 20, 2);
  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.map(c => Number(c.high ?? c.close)));
  const rangeLow = Math.min(...recent.map(c => Number(c.low ?? c.close)));
  const breakoutUp = currentPrice > rangeHigh;
  const breakoutDown = currentPrice < rangeLow;
  const bullishTrend = ema5 > ema20 && currentPrice >= ema5;
  const bearishTrend = ema5 < ema20 && currentPrice <= ema5;
  const isSideway = Number.isFinite(bb.bandwidth) && bb.bandwidth < 0.04 && !breakoutUp && !breakoutDown;

  let candidate = 'WAIT';
  let regime = 'CONSOLIDATION';
  let reason = 'แนวโน้มยังไม่ชัด · รอข้อมูลยืนยัน · STANDBY';
  if (breakoutUp) {
    candidate = 'CALL'; regime = 'BREAKOUT UP';
    reason = 'ราคาทะลุกรอบสูงสุด 20 แท่ง M1 · รอจังหวะยืนยันขาขึ้น';
  } else if (breakoutDown) {
    candidate = 'PUT'; regime = 'BREAKOUT DOWN';
    reason = 'ราคาหลุดกรอบต่ำสุด 20 แท่ง M1 · รอจังหวะยืนยันขาลง';
  } else if (isSideway) {
    regime = 'SIDEWAY / DANGER';
    reason = 'Bollinger Bandwidth ต่ำกว่า 0.04% · ตลาดแกว่งแคบ · STANDBY';
  } else if (bullishTrend) {
    candidate = 'CALL'; regime = 'UPTREND / MOMENTUM';
    reason = 'EMA5 เหนือ EMA20 และราคายืนเหนือ EMA5 · ตามเทรนด์ขาขึ้น';
  } else if (bearishTrend) {
    candidate = 'PUT'; regime = 'DOWNTREND / MOMENTUM';
    reason = 'EMA5 ใต้ EMA20 และราคาอยู่ใต้ EMA5 · ตามเทรนด์ขาลง';
  }

  let score = 65;
  if (bullishTrend || bearishTrend || breakoutUp || breakoutDown) score += 20;
  if (currentPrice !== prevPrice) score += 10;
  const confidence = Math.min(score, 96).toFixed(1);
  const date = new Date(now);
  const exactTimeLeft = 60 - (date.getSeconds() + date.getMilliseconds() / 1000);
  const trend = bullishTrend || breakoutUp ? 'BULLISH' : bearishTrend || breakoutDown ? 'BEARISH' : 'NEUTRAL';

  return {
    ready: true, signal: 'WAIT', candidate, regime,
    statusText: isSideway ? 'DANGER' : candidate === 'WAIT' ? 'CAUTION' : 'SAFE',
    statusColor: isSideway ? 'red' : candidate === 'WAIT' ? 'yellow' : 'green',
    confidence, rsi: Number(rsi.toFixed(1)), ema5, ema20,
    bandwidth: bb.bandwidth, rangeHigh, rangeLow, breakoutUp, breakoutDown,
    trend, trendLabel: trend === 'BULLISH' ? 'ขาขึ้น' : trend === 'BEARISH' ? 'ขาลง' : 'เป็นกลาง',
    isBullishTrend: bullishTrend, isBearishTrend: bearishTrend, isSideway,
    exactTimeLeft, currentPrice, previousPrice: prevPrice, reason
  };
}

module.exports = { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula };
