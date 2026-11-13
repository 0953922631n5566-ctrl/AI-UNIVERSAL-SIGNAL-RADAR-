// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Aggressive Momentum & Breakout is the sole directional decision-maker; system guards validate live source quality and distinct intraminute events.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "AGGRESSIVE_MOMENTUM_BREAKOUT_HIGH_RISK_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Aggressive Momentum · HIGH RISK · วิเคราะห์ได้ตลอดแท่ง M1 ด้วย 50+4 แท่งปิดและ Streaming สด · ยังไม่มีผลประเมิน out-of-sample · ใช้ทดสอบแบบ paper/manual เท่านั้น"
  };
}
