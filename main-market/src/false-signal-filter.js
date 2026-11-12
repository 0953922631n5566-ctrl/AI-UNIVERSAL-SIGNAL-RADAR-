/**
 * Level 1 strict false-signal filter.
 * Runs after Original84 scoring and before any directional signal can be released.
 * It only blocks high-specificity rejection/fakeout patterns; it does not alter scores.
 */
export function applyLevel1FalseSignalFilter(candles, analysis) {
  const direction = analysis?.signal;
  if (!["CALL", "PUT"].includes(direction)) {
    return { ...analysis, falseSignalFilter: { level: 1, blocked: false, reasons: [] } };
  }
  const current = Array.isArray(candles) ? candles.at(-1) : null;
  const previous = Array.isArray(candles) ? candles.at(-2) : null;
  if (!current || !previous ||
      ![current.open, current.high, current.low, current.close,
        previous.close].every(Number.isFinite)) {
    const reason = "LEVEL1_FILTER_MISSING_CANDLE_CONTEXT";
    return {
      ...analysis, signal: "STANDBY", status: "STANDBY", prepareSignal: null,
      reason: "Level 1 Filter: ข้อมูลแท่งเทียนไม่ครบ จึงระงับสัญญาณเพื่อความปลอดภัย",
      summary: "Level 1 Filter blocked: missing candle context",
      riskFlags: [...(analysis.riskFlags || []), reason],
      falseSignalFilter: { level: 1, blocked: true, reasons: [reason] }
    };
  }

  const range = Math.max(current.high - current.low, 1e-12);
  const body = Math.abs(current.close - current.open);
  const bodyRatio = body / range;
  const upperWickRatio = (current.high - Math.max(current.open, current.close)) / range;
  const lowerWickRatio = (Math.min(current.open, current.close) - current.low) / range;
  const opposingWickRatio = direction === "CALL" ? upperWickRatio : lowerWickRatio;
  const opposingRejection = opposingWickRatio >= 0.68 && bodyRatio <= 0.32;

  const prior = candles.slice(-8, -1);
  const resistance = prior.length ? Math.max(...prior.map(c => c.high)) : NaN;
  const support = prior.length ? Math.min(...prior.map(c => c.low)) : NaN;
  const failedBreakout = direction === "CALL"
    ? Number.isFinite(resistance) && current.high > resistance && current.close <= resistance &&
      upperWickRatio >= 0.35
    : Number.isFinite(support) && current.low < support && current.close >= support &&
      lowerWickRatio >= 0.35;

  const opposingCandleMomentum = direction === "CALL"
    ? current.close < current.open && current.close < previous.close
    : current.close > current.open && current.close > previous.close;
  const metrics = analysis.metrics || {};
  const opposingEmaSlope = Number.isFinite(metrics.ema5Slope) &&
    (direction === "CALL" ? metrics.ema5Slope < 0 : metrics.ema5Slope > 0);
  const opposingDmi = Number.isFinite(metrics.plusDI) && Number.isFinite(metrics.minusDI) &&
    (direction === "CALL" ? metrics.minusDI > metrics.plusDI : metrics.plusDI > metrics.minusDI);
  const stackedMomentumConflict = opposingCandleMomentum && opposingEmaSlope && opposingDmi;

  const reasons = [];
  if (opposingRejection) reasons.push("OPPOSING_WICK_REJECTION");
  if (failedBreakout) reasons.push("FAILED_BREAKOUT_FAKEOUT");
  if (stackedMomentumConflict) reasons.push("CANDLE_EMA_DMI_DIRECTION_CONFLICT");

  if (!reasons.length) {
    return {
      ...analysis,
      falseSignalFilter: {
        level: 1, blocked: false, reasons: [],
        diagnostics: { bodyRatio, upperWickRatio, lowerWickRatio, failedBreakout: false }
      }
    };
  }

  const note = "Level 1 Filter: ตรวจพบความเสี่ยงสัญญาณหลอก — บล็อกการปล่อยออเดอร์รอบนี้";
  return {
    ...analysis,
    signal: "STANDBY",
    status: "STANDBY",
    prepareSignal: null,
    reason: note,
    summary: note,
    riskFlags: [...(analysis.riskFlags || []), ...reasons.map(x => "LEVEL1_" + x)],
    falseSignalFilter: {
      level: 1, blocked: true, reasons,
      diagnostics: { bodyRatio, upperWickRatio, lowerWickRatio, failedBreakout }
    }
  };
}
