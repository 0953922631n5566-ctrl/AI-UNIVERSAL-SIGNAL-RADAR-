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
    signalValidationNote: "V1 Partial Scoring 65/45 ทำงานอิสระ · BB Pure Scalper วิเคราะห์และออกสัญญาณแยกโดยไม่แก้คะแนน V1 · ความขัดแย้งจะแสดงแยกตามเครื่องยนต์ · Data Quality และ Timing Guard ใช้ร่วมกัน · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"
  };
}
