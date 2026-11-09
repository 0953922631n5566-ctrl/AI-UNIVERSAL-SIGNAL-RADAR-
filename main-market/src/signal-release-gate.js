// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Gemini is the sole directional decision-maker; system guards only validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "GEMINI_PRIMARY_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Gemini เป็นผู้วิเคราะห์หลักเพียงตัวเดียว · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
