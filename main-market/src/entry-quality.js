const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/**
 * V1-only reversal/late-entry guard. Uses closed OHLC candles only.
 * It does not choose direction or alter score weights.
 */
export function assessEntryQuality(candles, direction, { atr, priceAction } = {}) {
  if (!Array.isArray(candles) || candles.length < 12 ||
      !["CALL", "PUT"].includes(direction) ||
      !Number.isFinite(atr) || atr <= 0 ||
      !priceAction?.ready ||
      !candles.slice(-7).every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return {
      ready: false, blocked: true, status: "UNAVAILABLE",
      flags: ["V1_ENTRY_QUALITY_UNAVAILABLE"],
      reason: "ข้อมูลแนวรับแนวต้านหรือแท่งปิดไม่เพียงพอ — พักสัญญาณเพื่อความปลอดภัย"
    };
  }

  const last = candles.at(-1);
  const prior = candles.slice(-7, -1);
  const swingHigh = Math.max(...prior.map(c => c.high));
  const swingLow = Math.min(...prior.map(c => c.low));
  const sign = direction === "CALL" ? 1 : -1;
  const range = Math.max(last.high - last.low, 1e-12);
  const bodyRatio = clamp(Math.abs(last.close - last.open) / range);
  const brokeSwing = direction === "CALL"
    ? last.close > swingHigh + atr * 0.05
    : last.close < swingLow - atr * 0.05;
  const distanceToOpposingSwingAtr = direction === "CALL"
    ? (swingHigh - last.close) / atr
    : (last.close - swingLow) / atr;
  const nearOpposingSwing = !brokeSwing &&
    distanceToOpposingSwingAtr >= 0 &&
    distanceToOpposingSwingAtr <= 0.20;

  const exhaustion = priceAction.exhaustion;
  const sameDirectionRun = exhaustion?.sameDirectionRun ?? 0;
  const bodyContraction = exhaustion?.bodyContraction ?? 0;
  const opposingWickRatio = exhaustion?.opposingWickRatio ?? 0;
  const continuationTrend = (direction === "CALL" && priceAction.structure.priorTrend === "UP") ||
    (direction === "PUT" && priceAction.structure.priorTrend === "DOWN");
  const fadingMatureRun = continuationTrend && sameDirectionRun >= 3 &&
    (bodyContraction >= 0.30 ||
      (opposingWickRatio >= 0.32 && bodyRatio <= 0.65)) && !brokeSwing;

  const flags = [];
  if (nearOpposingSwing) {
    flags.push(direction === "CALL" ? "V1_NEAR_SWING_RESISTANCE" : "V1_NEAR_SWING_SUPPORT");
  }
  if (fadingMatureRun) flags.push("V1_MATURE_RUN_EXHAUSTION");

  const blocked = flags.length > 0;
  const reasons = [];
  if (nearOpposingSwing) {
    reasons.push(direction === "CALL"
      ? "ราคาอยู่ชิดแนวต้านจาก swing high ยังไม่ปิดทะลุยืนยัน"
      : "ราคาอยู่ชิดแนวรับจาก swing low ยังไม่ปิดหลุดยืนยัน");
  }
  if (fadingMatureRun) {
    reasons.push("แรงต่อเนื่องเดินมาอย่างน้อย 3 แท่งและเริ่มหดตัว/มีไส้ต้าน — รอพักตัว");
  }

  return {
    ready: true, blocked, status: blocked ? "WAIT_FOR_CONFIRMATION" : "READY",
    flags, swingHigh, swingLow,
    distanceToOpposingSwingAtr: Number(distanceToOpposingSwingAtr.toFixed(3)),
    sameDirectionRun, bodyContraction: Number(bodyContraction.toFixed(3)),
    opposingWickRatio: Number(opposingWickRatio.toFixed(3)),
    confirmedBreakout: brokeSwing,
    reason: blocked ? reasons.join(" · ") : "ไม่พบความเสี่ยงชน swing หรือหมดแรงตามเกณฑ์ V1"
  };
}
