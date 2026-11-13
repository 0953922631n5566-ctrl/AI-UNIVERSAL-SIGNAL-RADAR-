// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Instant Momentum & Breakout is the sole directional decision-maker; system guards validate live source quality and the M1 opening window.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "INSTANT_MOMENTUM_BREAKOUT_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Instant Momentum & Breakout · M1 เปิดแท่ง 0–5 วินาที · 50 แท่งปิดเป็นบริบท · ยังไม่มีผลประเมิน out-of-sample · ใช้ทดสอบแบบ paper/manual เท่านั้น"
  };
}
