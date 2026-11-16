// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Local EMA5 Only Trend Flow is the sole directional decision-maker; system guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "PARTIAL_SCORING_65_AGILE_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "V1 Partial Scoring 65/45 เป็นเครื่องยนต์หลัก · BB Pure Scalper (20,2) เป็นตัวยืนยันเสริมเท่านั้น · ความขัดแย้งให้ STANDBY · Kill Switch สำหรับ Choppy/ATR Spike · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
