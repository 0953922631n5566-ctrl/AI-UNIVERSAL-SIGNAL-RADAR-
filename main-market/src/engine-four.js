// Engine 4: independent every-closed-candle directional analyzer.
// This engine intentionally does not use V1, BB, or Trend Rider scores.
function ema(values, period) {
  const alpha = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = values[i] * alpha + value * (1 - alpha);
  return value;
}

function validCandle(candle) {
  return candle && candle.live !== true &&
    [candle.epoch, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.epoch >= 0 && candle.low > 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low;
}

export function analyzeEveryCandle(input) {
  const source = Array.isArray(input) ? input.slice(-30) : [];
  if (source.length < 20 || source.slice(-20).some(candle => !validCandle(candle))) {
    return { ready: false, signal: null, status: "SOURCE_LOCKED", score: 0,
      reason: "Engine 4 ต้องมีแท่ง M1 ปิดที่ถูกต้องอย่างน้อย 20 แท่ง" };
  }

  const candles = source;
  const closes = candles.map(c => c.close);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const fast = ema(closes.slice(-5), 5);
  const slow = ema(closes.slice(-20), 20);
  const fastPrevious = ema(closes.slice(-6, -1), 5);
  const momentum3 = last.close - candles.at(-4).close;
  const momentum6 = last.close - candles.at(-7).close;
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const bodyRatio = (last.close - last.open) / range;
  const closeLocation = (last.close - last.low) / range;

  // Independent directional blend: trend alignment, EMA slope, short/medium
  // momentum, candle body, and close location. Sideways/weak scores still
  // produce a directional call when the underlying candle data is valid.
  const raw =
    (fast - slow) / last.close * 10000 * 1.4 +
    (fast - fastPrevious) / last.close * 10000 * 1.1 +
    (momentum3 / last.close) * 10000 * 0.9 +
    (momentum6 / last.close) * 10000 * 0.55 +
    bodyRatio * 0.75 +
    (closeLocation - 0.5) * 0.45;

  let signal;
  if (raw > 0) signal = "CALL";
  else if (raw < 0) signal = "PUT";
  else if (last.close !== last.open) signal = last.close > last.open ? "CALL" : "PUT";
  else if (last.close !== previous.close) signal = last.close > previous.close ? "CALL" : "PUT";
  else signal = fast >= slow ? "CALL" : "PUT";

  const score = Math.max(0, Math.min(100, Math.round(Math.abs(raw) * 45)));
  const bias = fast >= slow ? "EMA5 อยู่เหนือ EMA20" : "EMA5 อยู่ใต้ EMA20";
  const momentum = momentum3 >= 0 ? "โมเมนตัม 3 แท่งเป็นบวก" : "โมเมนตัม 3 แท่งเป็นลบ";
  return {
    ready: true, signal, candidateSignal: signal, status: "EVERY_CANDLE_SIGNAL",
    score, confidence: score, candleEpoch: last.epoch,
    alertId: `ENGINE_4:${last.epoch}:${signal}`,
    targetCandleAt: new Date((last.epoch + 60) * 1000).toISOString(),
    reason: `วิเคราะห์แท่งปิดล่าสุดแล้ว · ${bias} · ${momentum} · คะแนนแรงทิศทาง ${score}/100 · ออกสัญญาณทุกแท่ง`,
    metrics: {
      ema5: Number(fast.toFixed(6)), ema20: Number(slow.toFixed(6)),
      momentum3: Number(momentum3.toFixed(6)), momentum6: Number(momentum6.toFixed(6)),
      bodyRatio: Number(bodyRatio.toFixed(3)), closeLocation: Number(closeLocation.toFixed(3))
    }
  };
}
