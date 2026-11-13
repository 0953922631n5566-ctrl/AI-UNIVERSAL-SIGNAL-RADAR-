// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Local Partial Scoring is the directional decision-maker; system guards validate source, T-5 provisional entry data and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "PARTIAL_SCORING_65_AGILE_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Partial Scoring 65/45 เป็นเครื่องยนต์วิเคราะห์หลัก · Kill Switch สำหรับ Choppy/ATR Spike · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
