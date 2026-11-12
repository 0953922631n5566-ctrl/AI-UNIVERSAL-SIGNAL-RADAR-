// This flag describes validation maturity only; it is NOT a runtime signal lock.
// M5 LIVE + M1 entry is the sole directional decision-maker; existing guards validate live source and timing.
export const SIGNAL_RELEASE_VALIDATED = false;
export const SIGNAL_VALIDATION_STATUS = "M5_M1_LIVE_MANUAL_ONLY_NOT_OOS_VALIDATED";

export function applySignalReleaseGate(result) {
  return {
    ...(result && typeof result === "object" ? result : {}),
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseLocked: false,
    signalValidationStatus: SIGNAL_VALIDATION_STATUS,
    signalValidationNote: "M5 LIVE forming direction + M1 Pullback/Breakout confirmation · ต้องมี Twelve Data Streaming สด · ยังไม่มีผลทดสอบ out-of-sample · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ"
  };
}
