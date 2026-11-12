// This flag describes validation maturity only; it is NOT a runtime signal lock.
// ORIGINAL 84 is the sole directional decision-maker; existing guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "ORIGINAL_84_TUNED_62_42_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "ORIGINAL 84 · Partial Scoring 62/42 · CALL/PUT จาก EMA5 slope/reversal, S/R fakeout, proximity/momentum และ trend context · Choppy/ATR kill switches · ยังไม่มีผลทดสอบ out-of-sample · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ"
  };
}
