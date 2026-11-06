// Directional signals remain disabled until an independent out-of-sample evaluation
// of the complete perception and decision pipeline has been reviewed and recorded.
export const SIGNAL_RELEASE_VALIDATED = false;

export function applySignalReleaseGate(result, validated = SIGNAL_RELEASE_VALIDATED) {
  if (validated) return result;

  const sourceReason = typeof result?.reason === "string" && result.reason.trim()
    ? result.reason.trim()
    : "ยังไม่มีเหตุผลจากตัววิเคราะห์";
  const candidate = ["CALL", "PUT"].includes(result?.signal) ? result.signal : null;

  return {
    ...(result && typeof result === "object" ? result : {}),
    signal: "STANDBY",
    reason: [
      "ปิด CALL/PUT ไว้จนกว่า perception และ decision pipeline จะผ่านการประเมิน out-of-sample",
      candidate ? `ระงับ candidate ${candidate}` : null,
      sourceReason
    ].filter(Boolean).join(" · "),
    preAlertSignal: null,
    alertId: null,
    signalExpiresAt: null,
    signalReleaseValidated: false,
    signalReleaseLocked: true
  };
}
