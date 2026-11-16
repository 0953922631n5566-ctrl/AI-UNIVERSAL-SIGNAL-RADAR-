const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/**
 * V1-only entry-quality guard. It does not choose direction or change the score;
 * it only prevents a high-scoring signal from chasing an already extended move.
 */
export function assessEntryTiming(candles, direction, { ema5, atr, exhaustionScore = 0 } = {}) {
  if (!Array.isArray(candles) || candles.length < 3 ||
      !["CALL", "PUT"].includes(direction) ||
      !Number.isFinite(ema5) || !Number.isFinite(atr) || atr <= 0 ||
      !candles.slice(-3).every(c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite))) {
    return {
      ready: false, status: "UNAVAILABLE", waitForPullback: true,
      extensionAtr: null, sameDirectionRun: 0, exhaustionScore: null,
      reason: "ข้อมูลประเมินจังหวะเข้าไม่เพียงพอ"
    };
  }

  const last = candles.at(-1);
  const sign = direction === "CALL" ? 1 : -1;
  const extensionAtr = Math.max(0, sign * (last.close - ema5) / atr);
  const candleDirection = Math.sign(last.close - last.open);
  let sameDirectionRun = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 5); i--) {
    const candle = candles[i];
    if (Math.sign(candle.close - candle.open) !== sign) break;
    sameDirectionRun++;
  }

  const range = Math.max(last.high - last.low, 1e-12);
  const bodyRatio = clamp(Math.abs(last.close - last.open) / range);
  const opposingWick = direction === "CALL"
    ? (last.high - Math.max(last.open, last.close)) / range
    : (Math.min(last.open, last.close) - last.low) / range;
  const alignedExhaustion = candleDirection === sign
    ? clamp(Number.isFinite(exhaustionScore) ? exhaustionScore : 0)
    : 0;
  const rangeAtr = (last.high - last.low) / atr;

  // Avoid chasing only when extension is meaningful and there is evidence
  // of a mature/fading run; a normal EMA pullback or fresh reversal stays eligible.
  const stretchedAndFading = extensionAtr >= 1.25 &&
    (sameDirectionRun >= 3 || alignedExhaustion >= 0.48 ||
      (rangeAtr >= 1.5 && opposingWick >= 0.25 && bodyRatio < 0.55));
  const extremeExtension = extensionAtr >= 1.8 && sameDirectionRun >= 2;
  const waitForPullback = stretchedAndFading || extremeExtension;

  return {
    ready: true,
    status: waitForPullback ? "WAIT_FOR_PULLBACK" : "READY",
    waitForPullback,
    extensionAtr: Number(extensionAtr.toFixed(3)),
    sameDirectionRun,
    exhaustionScore: Number(alignedExhaustion.toFixed(3)),
    rangeAtr: Number(rangeAtr.toFixed(3)),
    opposingWickRatio: Number(opposingWick.toFixed(3)),
    reason: waitForPullback
      ? `ราคาเคลื่อนห่าง EMA5 ${extensionAtr.toFixed(2)} ATR และแรงรอบล่าสุดเริ่มยืด/อ่อน — รอจังหวะย่อก่อนเข้า`
      : "จังหวะเข้าไม่ยืดเกินเกณฑ์ สามารถประเมินตามคะแนน V1 ได้"
  };
}
