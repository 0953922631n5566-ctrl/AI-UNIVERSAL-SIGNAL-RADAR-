// This flag describes validation maturity only; it is NOT a runtime signal lock.
// ORIGINAL 84 is the sole directional decision-maker; existing guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "M1_PRECISION_ENTRY_80_60_MARGIN_12_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "M1 Precision Entry 25/25/20/15/15 · CALL/PUT ≥80 คะแนนและส่วนต่าง ≥12 · PREPARE ≥60 · ผ่าน Level 1 False-Signal Filter และ Choppy/ATR Safety Guards · ยังไม่มีผลทดสอบ out-of-sample · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ"
  };
}
