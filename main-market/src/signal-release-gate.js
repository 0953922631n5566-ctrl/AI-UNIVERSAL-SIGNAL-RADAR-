// This flag describes validation maturity only; it is NOT a runtime signal lock.
// Accuracy Lab is the sole directional decision-maker; existing guards validate source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "ACCURACY_LAB_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "TREND ONLY · UPTREND (HH/HL) อนุญาตเฉพาะ CALL · DOWNTREND (LH/LL) อนุญาตเฉพาะ PUT · SIDEWAY/UNCLEAR/TRANSITION/HIGH VOLATILITY งดสัญญาณ · ยังไม่มีผลทดสอบ out-of-sample · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ"
  };
}
