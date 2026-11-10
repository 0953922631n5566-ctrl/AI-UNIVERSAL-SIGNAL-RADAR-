// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Local EMA 5/20 Wick Rejection is the sole directional decision-maker; system guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "EMA_5_20_WICK_REJECTION_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "EMA 5/20 Wick Rejection เป็นเครื่องยนต์วิเคราะห์หลัก · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
