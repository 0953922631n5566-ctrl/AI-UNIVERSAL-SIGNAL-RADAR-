const MAX_WAIT_CANDLES = 3;

export function createRecoveryState() {
  return { status: "IDLE", armedByAlertId: null, armedAtCandleEpoch: null,
    expiresAtCandleEpoch: null, attemptAlertId: null, lastOutcome: null, lastAttemptAt: null };
}

export function evaluateM1Outcome(signal, candle) {
  const validSignal = signal === "CALL" || signal === "PUT";
  const validCandle = candle &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;
  if (!validSignal || !validCandle) return {
    outcome: "UNKNOWN", entryPrice: Number.isFinite(candle?.open) ? candle.open : null,
    exitPrice: Number.isFinite(candle?.close) ? candle.close : null,
    reason: !validSignal ? "INVALID_SIGNAL" : "INCOMPLETE_OR_INVALID_M1_OHLC"
  };
  if (candle.close === candle.open) return {
    outcome: "FLAT", entryPrice: candle.open, exitPrice: candle.close, reason: "OPEN_EQUALS_CLOSE"
  };
  const won = signal === "CALL" ? candle.close > candle.open : candle.close < candle.open;
  return { outcome: won ? "WIN" : "LOSS", entryPrice: candle.open, exitPrice: candle.close,
    reason: signal === "CALL" ? "CALL_OPEN_TO_CLOSE" : "PUT_OPEN_TO_CLOSE" };
}

export function armRecoveryAfterLoss(state, record) {
  const current = state || createRecoveryState();
  if (record?.mode === "RECOVERY_SHADOW" || record?.outcome !== "LOSS" ||
      !Number.isFinite(record.targetCandleEpoch)) return current;
  return { status: "ARMED", armedByAlertId: record.alertId || null,
    armedAtCandleEpoch: record.targetCandleEpoch,
    expiresAtCandleEpoch: record.targetCandleEpoch + MAX_WAIT_CANDLES * 60,
    attemptAlertId: null, lastOutcome: "LOSS", lastAttemptAt: null };
}

export function inspectRecoveryWindow(state, sourceCandleEpoch) {
  const current = state || createRecoveryState();
  if (current.status !== "ARMED" || !Number.isFinite(sourceCandleEpoch)) {
    return { state: current, mode: "NORMAL" };
  }
  if (sourceCandleEpoch > current.expiresAtCandleEpoch) {
    return { state: { ...createRecoveryState(), lastOutcome: "EXPIRED" }, mode: "NORMAL" };
  }
  return { state: current, mode: "RECOVERY_SHADOW" };
}

export function markRecoveryAttempt(state, record) {
  const current = state || createRecoveryState();
  if (current.status !== "ARMED" || !record?.alertId) return current;
  return { ...current, status: "ATTEMPT_PENDING", attemptAlertId: record.alertId,
    lastAttemptAt: record.signalAt || null };
}

export function settleRecoveryAttempt(state, record) {
  const current = state || createRecoveryState();
  if (current.status !== "ATTEMPT_PENDING" ||
      (current.attemptAlertId && current.attemptAlertId !== record?.alertId)) return current;
  return { ...createRecoveryState(), lastOutcome: record?.outcome || "UNKNOWN",
    lastAttemptAt: current.lastAttemptAt };
}

export const RECOVERY_POLICY = Object.freeze({
  mode: "SHADOW_ONLY", expiryMinutes: 1, maxAttemptsPerLoss: 1,
  maxWaitCandles: MAX_WAIT_CANDLES, martingale: false, minimumScore: 65
});
