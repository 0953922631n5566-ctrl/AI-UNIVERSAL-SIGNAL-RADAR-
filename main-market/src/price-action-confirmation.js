const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function candleShape(candle) {
  const range = Math.max(candle.high - candle.low, 1e-12);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const closeLocation = clamp((candle.close - candle.low) / range);
  return {
    range, body, bodyRatio: clamp(body / range),
    upperWickRatio: clamp(upperWick / range),
    lowerWickRatio: clamp(lowerWick / range),
    closeLocation
  };
}

/**
 * Closed-candle-only price-action evidence. No future bars or live candle values are read.
 * BOS/CHOCH is contextual evidence, never a standalone direction trigger.
 */
export function analyzePriceAction(candles, { ema5, atr } = {}) {
  if (!Array.isArray(candles) || candles.length < 12 ||
      !candles.every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return { ready: false, reason: "INSUFFICIENT_VALID_CLOSED_CANDLES" };
  }
  const lastIndex = candles.length - 1;
  const current = candles[lastIndex];
  const previous = candles[lastIndex - 1];
  const swingWindow = candles.slice(-7, -1);
  const swingHigh = Math.max(...swingWindow.map(c => c.high));
  const swingLow = Math.min(...swingWindow.map(c => c.low));
  const priorTrendWindow = candles.slice(-12, -2);
  const priorMove = priorTrendWindow.at(-1).close - priorTrendWindow[0].close;
  const priorTrend = priorMove > 0 ? "UP" : priorMove < 0 ? "DOWN" : "RANGE";
  const brokeHigh = current.close > swingHigh;
  const brokeLow = current.close < swingLow;
  let structureEvent = "NONE";
  let structureDirection = null;
  if (brokeHigh && priorTrend === "DOWN") { structureEvent = "CHOCH"; structureDirection = "CALL"; }
  else if (brokeLow && priorTrend === "UP") { structureEvent = "CHOCH"; structureDirection = "PUT"; }
  else if (brokeHigh) { structureEvent = "BOS"; structureDirection = "CALL"; }
  else if (brokeLow) { structureEvent = "BOS"; structureDirection = "PUT"; }

  const shape = candleShape(current);
  const bullish = current.close > current.open;
  const bearish = current.close < current.open;
  const candleConfirmation = {
    CALL: clamp(0.50 * (bullish ? shape.bodyRatio : 0) + 0.30 * shape.closeLocation + 0.20 * shape.lowerWickRatio),
    PUT: clamp(0.50 * (bearish ? shape.bodyRatio : 0) + 0.30 * (1 - shape.closeLocation) + 0.20 * shape.upperWickRatio)
  };

  const recentShapes = candles.slice(-4, -1).map(candleShape);
  const priorBodyRatio = mean(recentShapes.map(item => item.bodyRatio));
  const bodyContraction = priorBodyRatio > 0 ? clamp((priorBodyRatio - shape.bodyRatio) / priorBodyRatio) : 0;
  const extensionAtr = Number.isFinite(ema5) && Number.isFinite(atr) && atr > 0
    ? Math.abs(current.close - ema5) / atr : 0;
  const sameDirectionRun = (() => {
    const direction = bullish ? 1 : bearish ? -1 : 0;
    if (!direction) return 0;
    let count = 0;
    for (let i = lastIndex; i >= Math.max(0, lastIndex - 4); i--) {
      const candle = candles[i];
      if (Math.sign(candle.close - candle.open) !== direction) break;
      count++;
    }
    return count;
  })();
  const opposingWickRatio = bullish ? shape.upperWickRatio : bearish ? shape.lowerWickRatio : 0;
  const exhaustionRaw = clamp(
    0.40 * clamp((extensionAtr - 0.75) / 1.25) +
    0.25 * bodyContraction +
    0.20 * clamp((sameDirectionRun - 2) / 3) +
    0.15 * clamp((opposingWickRatio - 0.20) / 0.55)
  );
  const exhaustion = {
    score: exhaustionRaw,
    extensionAtr: Number(extensionAtr.toFixed(3)),
    bodyContraction: Number(bodyContraction.toFixed(3)),
    sameDirectionRun,
    opposingWickRatio: Number(opposingWickRatio.toFixed(3)),
    level: exhaustionRaw >= 0.70 ? "HIGH" : exhaustionRaw >= 0.40 ? "WATCH" : "LOW"
  };

  const structureScore = direction => {
    if (structureEvent === "NONE") return 0.50;
    if (structureDirection === direction) return structureEvent === "CHOCH" ? 1.0 : 0.90;
    return 0.15;
  };
  const freshnessScore = direction => {
    const alignedBody = direction === "CALL" ? bullish : bearish;
    const directionalConfirmation = candleConfirmation[direction];
    return clamp(0.65 * (1 - exhaustionRaw) + 0.35 * directionalConfirmation) *
      (alignedBody ? 1 : 0.82);
  };

  return {
    ready: true,
    structure: {
      event: structureEvent, direction: structureDirection, priorTrend,
      brokeSwingHigh: brokeHigh, brokeSwingLow: brokeLow, swingHigh, swingLow,
      callScore: structureScore("CALL"), putScore: structureScore("PUT")
    },
    candle: {
      bullish, bearish, bodyRatio: Number(shape.bodyRatio.toFixed(3)),
      upperWickRatio: Number(shape.upperWickRatio.toFixed(3)),
      lowerWickRatio: Number(shape.lowerWickRatio.toFixed(3)),
      closeLocation: Number(shape.closeLocation.toFixed(3)),
      callScore: Number(candleConfirmation.CALL.toFixed(3)),
      putScore: Number(candleConfirmation.PUT.toFixed(3))
    },
    exhaustion,
    callFreshnessScore: Number(freshnessScore("CALL").toFixed(3)),
    putFreshnessScore: Number(freshnessScore("PUT").toFixed(3)),
    callStructureScore: structureScore("CALL"),
    putStructureScore: structureScore("PUT"),
    evidence: [
      `Market Structure: ${structureEvent}${structureDirection ? ` ${structureDirection}` : ""} · prior ${priorTrend}`,
      `Candle: body ${shape.bodyRatio.toFixed(2)} · lower wick ${shape.lowerWickRatio.toFixed(2)} · upper wick ${shape.upperWickRatio.toFixed(2)}`,
      `Momentum exhaustion: ${exhaustion.level} · extension ${extensionAtr.toFixed(2)} ATR · same-direction run ${sameDirectionRun}`
    ]
  };
}
