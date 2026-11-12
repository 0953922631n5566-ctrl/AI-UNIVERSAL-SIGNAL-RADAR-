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
 * Active BOS/CHOCH and candle confirmation inputs for M1 signal scoring.
 * Uses confirmed 2-left/2-right swing pivots and the latest closed candle.
 * Modifiers are bounded and transparent; they influence CALL/PUT scores without
 * independently forcing a trade or changing the existing 40/60 thresholds.
 */
export function calculateStructureCandleContext(candles) {
  if (!validCandles(candles)) {
    return {
      ready: false, mode: "ACTIVE_SCORING", bias: "UNCONFIRMED", event: "NONE",
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
    mode: "ACTIVE_SCORING", bias, event, swingHigh, swingLow,
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


/**
 * Direction-specific additive score adjustments.
 * BOS ±5, CHOCH ±7, structural bias ±2, rejection candle ±6,
 * and decisive body/wick impulse ±4. Opposing evidence subtracts points.
 */
export function calculateStructureCandleAdjustment(context, direction) {
  if (!context?.ready || !["CALL", "PUT"].includes(direction)) {
    return { eventPoints: 0, biasPoints: 0, rejectionPoints: 0, bodyWickPoints: 0, total: 0 };
  }
  const sign = direction === "CALL" ? 1 : -1;
  const eventDirection = ["BOS_UP", "CHOCH_UP"].includes(context.event) ? 1
    : ["BOS_DOWN", "CHOCH_DOWN"].includes(context.event) ? -1 : 0;
  const eventStrength = context.event?.startsWith("CHOCH") ? 7 : context.event?.startsWith("BOS") ? 5 : 0;
  const eventPoints = eventDirection * sign * eventStrength;
  const biasDirection = context.bias === "BULLISH" ? 1 : context.bias === "BEARISH" ? -1 : 0;
  const biasPoints = biasDirection * sign * 2;
  const rejectionDirection = context.candlePattern === "BULLISH_REJECTION" ? 1
    : context.candlePattern === "BEARISH_REJECTION" ? -1 : 0;
  const rejectionPoints = rejectionDirection * sign * 6;
  const impulseDirection = context.candlePattern === "BULLISH_IMPULSE" ? 1
    : context.candlePattern === "BEARISH_IMPULSE" ? -1 : 0;
  const bodyWickPoints = impulseDirection * sign * 4;
  return {
    eventPoints, biasPoints, rejectionPoints, bodyWickPoints,
    total: eventPoints + biasPoints + rejectionPoints + bodyWickPoints
  };
}
