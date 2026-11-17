const MAX_WAIT_CANDLES = 3;

export function createRecoveryState() {
  return { status: "IDLE", armedByAlertId: null, armedAtCandleEpoch: null,
    expiresAtCandleEpoch: null, attemptAlertId: null, lastOutcome: null,
    lastAttemptAt: null, attempts: 0 };
}

export function evaluateM1Outcome(signal, candle, entryPrice = candle?.open) {
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
  const validEntryPrice = Number.isFinite(entryPrice) && entryPrice >= candle.low && entryPrice <= candle.high;
  const entry = validEntryPrice ? entryPrice : candle.open;
  if (candle.close === entry) return {
    outcome: "FLAT", entryPrice: entry, exitPrice: candle.close, reason: "ENTRY_EQUALS_CLOSE"
  };
  const won = signal === "CALL" ? candle.close > entry : candle.close < entry;
  return { outcome: won ? "WIN" : "LOSS", entryPrice: entry, exitPrice: candle.close,
    reason: signal === "CALL" ? "CALL_ENTRY_TO_CLOSE" : "PUT_ENTRY_TO_CLOSE" };
}

export function armRecoveryAfterLoss(state, record) {
  const current = state || createRecoveryState();
  if (record?.outcome !== "LOSS" || !Number.isFinite(record.targetCandleEpoch)) return current;
  return { ...current, status: "ARMED", armedByAlertId: record.alertId || null,
    armedAtCandleEpoch: record.targetCandleEpoch,
    // Kept for diagnostics only. Recovery no longer expires after a fixed number of candles.
    expiresAtCandleEpoch: null, attemptAlertId: null, lastOutcome: "LOSS", lastAttemptAt: null };
}

export function inspectRecoveryWindow(state, sourceCandleEpoch) {
  const current = state || createRecoveryState();
  if (current.status !== "ARMED" || !Number.isFinite(sourceCandleEpoch)) {
    return { state: current, mode: "NORMAL" };
  }
  return { state: current, mode: "RECOVERY_ACTIVE" };
}

export function markRecoveryAttempt(state, record) {
  const current = state || createRecoveryState();
  if (current.status !== "ARMED" || !record?.alertId) return current;
  return { ...current, status: "ATTEMPT_PENDING", attemptAlertId: record.alertId,
    lastAttemptAt: record.signalAt || null, attempts: (current.attempts || 0) + 1 };
}

export function settleRecoveryAttempt(state, record) {
  const current = state || createRecoveryState();
  if (current.status !== "ATTEMPT_PENDING" ||
      (current.attemptAlertId && current.attemptAlertId !== record?.alertId)) return current;
  const outcome = record?.outcome || "UNKNOWN";
  if (outcome === "WIN") {
    return { ...createRecoveryState(), lastOutcome: "WIN", lastAttemptAt: current.lastAttemptAt };
  }
  // A loss, flat candle, or unknown result keeps recovery armed for a fresh
  // analysis on the next M1 candle. It never flips the previous direction.
  return { ...current, status: "ARMED", attemptAlertId: null, lastOutcome: outcome,
    armedByAlertId: record?.alertId || current.armedByAlertId };
}

export function selectRecoveryCandidate(candidates, engine, mode, enabledEngines = Object.keys(candidates || {}), minimumScore = 60) {
  if (mode !== "RECOVERY_ACTIVE") return candidates?.[engine] || null;
  return Object.entries(candidates || {})
    .filter(([key, candidate]) => enabledEngines.includes(key) &&
      ["CALL", "PUT"].includes(candidate?.signal) &&
      Number.isFinite(Number(candidate?.score ?? candidate?.confidence ?? 0)) &&
      (minimumScore === null || minimumScore === undefined || Number(candidate.score ?? candidate.confidence ?? 0) >= minimumScore))
    .sort((a, b) => Number(b[1].score ?? b[1].confidence ?? 0) - Number(a[1].score ?? a[1].confidence ?? 0))
    .map(([sourceEngine, candidate]) => ({ ...candidate, sourceEngine }))[0] || null;
}

export const RECOVERY_POLICY = Object.freeze({
  mode: "ACTIVE", expiryMinutes: null, maxAttemptsPerLoss: null,
  maxWaitCandles: null, martingale: false, minimumScore: null,
  strategy: "REANALYZE_WITH_ORIGINAL_ENGINE_EACH_NEXT_M1"
});
