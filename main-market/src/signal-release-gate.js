// This flag describes validation maturity only; it is NOT a runtime signal lock.
// CALL/PUT candidates remain governed by Original AI and live-data quality gates.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "RULE_BASED_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "Original AI rule-based candidate · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
