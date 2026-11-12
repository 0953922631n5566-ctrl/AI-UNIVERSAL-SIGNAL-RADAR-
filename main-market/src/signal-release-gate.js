// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Adaptive EMA Pool (32 horizons, EMA 2–33) is the sole directional decision-maker; system guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "ADAPTIVE_EMA32_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Adaptive EMA Pool 32 ช่วง (EMA 2–33) · Warm-up 100 แท่ง · Sideway/High Volatility = STANDBY · ยังไม่มีผลประเมิน out-of-sample · ใช้ทดสอบแบบ paper/manual เท่านั้น"
  };
}
