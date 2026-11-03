// Real-data multi-regime M1 analysis: EMA trend following, RSI momentum confirmation,
// range breakout, and a narrowly-scoped sideway reversal exception.
function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) return null;
  const k = 2 / (period + 1);
  // Standard EMA initialization: seed with the first period's SMA.
  let ema = prices.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
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
  // Wilder RSI: seed with the first period's average gain/loss, then smooth.
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
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
  const rsiBullish = rsi >= 50;
  const rsiBearish = rsi <= 50;
  const isSideway = Number.isFinite(bb.bandwidth) && bb.bandwidth < 0.04 && !breakoutUp && !breakoutDown;
  const rangeWidth = Math.max(0, rangeHigh - rangeLow);
  const edgeTolerance = Math.max(rangeWidth * 0.18, currentPrice * 0.00005);
  const sidewaySupportBounce = isSideway && currentPrice <= rangeLow + edgeTolerance && rsi <= 45;
  const sidewayResistanceDrop = isSideway && currentPrice >= rangeHigh - edgeTolerance && rsi >= 55;

  let candidate = 'WAIT';
  let regime = 'CONSOLIDATION';
  let reason = 'แนวโน้มยังไม่ชัด · รอข้อมูลยืนยัน · STANDBY';

  // Breakouts must agree with EMA direction and RSI momentum; otherwise wait.
  if (breakoutUp && bullishTrend && rsiBullish) {
    candidate = 'CALL'; regime = 'BREAKOUT UP';
    reason = 'ทะลุกรอบสูงสุด 20 แท่ง พร้อม EMA5 > EMA20 และ RSI14 >= 50 · ตามแรงขาขึ้น';
  } else if (breakoutDown && bearishTrend && rsiBearish) {
    candidate = 'PUT'; regime = 'BREAKOUT DOWN';
    reason = 'หลุดกรอบต่ำสุด 20 แท่ง พร้อม EMA5 < EMA20 และ RSI14 <= 50 · ตามแรงขาลง';
  } else if (breakoutUp || breakoutDown) {
    regime = 'BREAKOUT · TREND FILTER';
    reason = 'ราคาทะลุกรอบแต่ EMA/RSI ยังไม่ยืนยันไปทางเดียวกัน · STANDBY เพื่อไม่สวนเทรนด์';
  } else if (sidewaySupportBounce) {
    candidate = 'CALL'; regime = 'SIDEWAY SUPPORT BOUNCE';
    reason = 'ตลาดแกว่งในกรอบ · ราคาใกล้แนวรับและ RSI14 <= 45 ยืนยันแรงเด้ง · CALL';
  } else if (sidewayResistanceDrop) {
    candidate = 'PUT'; regime = 'SIDEWAY RESISTANCE DROP';
    reason = 'ตลาดแกว่งในกรอบ · ราคาใกล้แนวต้านและ RSI14 >= 55 ยืนยันแรงอ่อน · PUT';
  } else if (isSideway) {
    regime = 'SIDEWAY / WAIT';
    reason = 'ตลาดแกว่งแคบแต่ยังไม่ยืนยันการเด้งจากขอบกรอบ · STANDBY';
  } else if (bullishTrend && rsiBullish) {
    candidate = 'CALL'; regime = 'UPTREND / MOMENTUM';
    reason = 'EMA5 > EMA20, ราคายืนเหนือ EMA5 และ RSI14 >= 50 · ตามเทรนด์ขาขึ้น';
  } else if (bearishTrend && rsiBearish) {
    candidate = 'PUT'; regime = 'DOWNTREND / MOMENTUM';
    reason = 'EMA5 < EMA20, ราคาอยู่ใต้ EMA5 และ RSI14 <= 50 · ตามเทรนด์ขาลง';
  } else if (bullishTrend || bearishTrend) {
    regime = 'TREND · RSI FILTER';
    reason = 'EMA แสดงแนวโน้มแต่ RSI14 ยังไม่ยืนยันโมเมนตัม · STANDBY';
  }

  let score = 65;
  if ((bullishTrend && rsiBullish) || (bearishTrend && rsiBearish) || (breakoutUp && bullishTrend && rsiBullish) || (breakoutDown && bearishTrend && rsiBearish)) score += 20;
  if (currentPrice !== prevPrice) score += 10;
  if (candidate === 'WAIT') score = Math.min(score, 65);
  const confidence = Math.min(score, 96).toFixed(1);
  const date = new Date(now);
  const exactTimeLeft = 60 - (date.getSeconds() + date.getMilliseconds() / 1000);
  const trend = bullishTrend || (breakoutUp && rsiBullish) || sidewaySupportBounce
    ? 'BULLISH'
    : bearishTrend || (breakoutDown && rsiBearish) || sidewayResistanceDrop ? 'BEARISH' : 'NEUTRAL';

  return {
    ready: true, signal: 'WAIT', candidate, regime,
    statusText: isSideway && candidate === 'WAIT' ? 'DANGER' : candidate === 'WAIT' ? 'CAUTION' : 'SAFE',
    statusColor: isSideway && candidate === 'WAIT' ? 'red' : candidate === 'WAIT' ? 'yellow' : 'green',
    confidence, rsi: Number(rsi.toFixed(1)), ema5, ema20,
    bandwidth: bb.bandwidth, rangeHigh, rangeLow, breakoutUp, breakoutDown,
    rsiBullish, rsiBearish, sidewaySupportBounce, sidewayResistanceDrop,
    trend, trendLabel: trend === 'BULLISH' ? 'ขาขึ้น' : trend === 'BEARISH' ? 'ขาลง' : 'เป็นกลาง',
    isBullishTrend: bullishTrend, isBearishTrend: bearishTrend, isSideway,
    exactTimeLeft, currentPrice, previousPrice: prevPrice, reason
  };
}

module.exports = { calculateEMA, calculateBB, calculateRSI, evaluateLiveFormula };
