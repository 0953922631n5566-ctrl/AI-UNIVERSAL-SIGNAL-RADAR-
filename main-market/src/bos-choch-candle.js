const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

function validCandles(candles) {
  return Array.isArray(candles) && candles.length >= 12 && candles.every(c =>
    c && [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high >= c.low
  );
}

function confirmedPivots(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  // The last 'right' candles cannot become pivots yet; this avoids look-ahead/repainting.
  for (let i = left; i < candles.length - right; i++) {
    const window = candles.slice(i - left, i + right + 1);
    const high = candles[i].high;
    const low = candles[i].low;
    if (window.every((c, j) => j === left || high > c.high)) highs.push({ index: i, price: high });
    if (window.every((c, j) => j === left || low < c.low)) lows.push({ index: i, price: low });
  }
  return { highs, lows };
}

function structureBias(highs, lows) {
  if (highs.length < 2 || lows.length < 2) return "UNCONFIRMED";
  const h1 = highs.at(-2).price, h2 = highs.at(-1).price;
  const l1 = lows.at(-2).price, l2 = lows.at(-1).price;
  if (h2 > h1 && l2 > l1) return "BULLISH";
  if (h2 < h1 && l2 < l1) return "BEARISH";
  return "MIXED";
}

function candleShape(candle) {
  const range = Math.max(candle.high - candle.low, 1e-12);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bodyRatio = clamp(body / range);
  const upperWickRatio = clamp(upperWick / range);
  const lowerWickRatio = clamp(lowerWick / range);
  const closeLocation = clamp((candle.close - candle.low) / range);
  const bullishRejection = lowerWickRatio >= 0.45 && lowerWick >= upperWick * 1.5 && closeLocation >= 0.55;
  const bearishRejection = upperWickRatio >= 0.45 && upperWick >= lowerWick * 1.5 && closeLocation <= 0.45;
  const bullishImpulse = candle.close > candle.open && bodyRatio >= 0.65 && closeLocation >= 0.80;
  const bearishImpulse = candle.close < candle.open && bodyRatio >= 0.65 && closeLocation <= 0.20;
  const pattern = bullishImpulse ? "BULLISH_IMPULSE"
    : bearishImpulse ? "BEARISH_IMPULSE"
    : bullishRejection ? "BULLISH_REJECTION"
    : bearishRejection ? "BEARISH_REJECTION" : "NEUTRAL";
  return { pattern, bodyRatio, upperWickRatio, lowerWickRatio, closeLocation };
}

/**
 * Shadow-only market structure and candle diagnostics.
 * Uses confirmed 2-left/2-right swing pivots and the latest closed candle.
 * This module never creates a direction and is not allowed to gate the active signal.
 */
export function calculateStructureCandleContext(candles) {
  if (!validCandles(candles)) {
    return {
      ready: false, mode: "SHADOW_ONLY", bias: "UNCONFIRMED", event: "NONE",
      candlePattern: "UNAVAILABLE", bodyRatio: null, upperWickRatio: null, lowerWickRatio: null,
      swingHigh: null, swingLow: null, callStructureConflict: false, putStructureConflict: false,
      callCandleConflict: false, putCandleConflict: false
    };
  }
  const { highs, lows } = confirmedPivots(candles);
  const bias = structureBias(highs, lows);
  const last = candles.at(-1);
  const swingHigh = highs.at(-1)?.price ?? null;
  const swingLow = lows.at(-1)?.price ?? null;
  const brokeHigh = swingHigh !== null && last.close > swingHigh;
  const brokeLow = swingLow !== null && last.close < swingLow;
  let event = "NONE";
  if (brokeHigh && brokeLow) event = "AMBIGUOUS_BREAK";
  else if (brokeHigh) event = bias === "BEARISH" ? "CHOCH_UP" : "BOS_UP";
  else if (brokeLow) event = bias === "BULLISH" ? "CHOCH_DOWN" : "BOS_DOWN";
  const shape = candleShape(last);
  const bearishStructureEvent = event === "BOS_DOWN" || event === "CHOCH_DOWN";
  const bullishStructureEvent = event === "BOS_UP" || event === "CHOCH_UP";
  const bearishCandle = shape.pattern === "BEARISH_IMPULSE" || shape.pattern === "BEARISH_REJECTION";
  const bullishCandle = shape.pattern === "BULLISH_IMPULSE" || shape.pattern === "BULLISH_REJECTION";
  return {
    ready: highs.length >= 1 && lows.length >= 1,
    mode: "SHADOW_ONLY", bias, event, swingHigh, swingLow,
    lastSwingHighIndex: highs.at(-1)?.index ?? null,
    lastSwingLowIndex: lows.at(-1)?.index ?? null,
    ...{ candlePattern: shape.pattern, bodyRatio: shape.bodyRatio,
      upperWickRatio: shape.upperWickRatio, lowerWickRatio: shape.lowerWickRatio,
      closeLocation: shape.closeLocation },
    callStructureConflict: bearishStructureEvent,
    putStructureConflict: bullishStructureEvent,
    callCandleConflict: bearishCandle,
    putCandleConflict: bullishCandle
  };
}
