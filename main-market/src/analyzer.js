import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { MIN_CLOSED_CANDLES, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS } from "./config.js";

const require = createRequire(import.meta.url);
const {
  prepareMarket: prepareOriginalMarket,
  finalizeMarket: finalizeOriginalMarket
} = require("../original-ai/engine/analyze-market.js");
let simulationCache = { key: null, result: null };

function sourceGate(candles, options) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const closed = Array.isArray(candles)
    ? candles.filter(c => c && c.live !== true && Number.isFinite(c.epoch) && c.epoch < Math.floor(now / 60000) * 60)
    : [];
  const last = closed.at(-1) || null;
  const ageSeconds = last ? Math.max(0, now / 1000 - (last.epoch + 60)) : Infinity;
  const stream = Number.isFinite(options.tickAgeSeconds) &&
    options.tickAgeSeconds >= 0 && options.tickAgeSeconds <= MAX_STREAM_AGE_SECONDS;
  const rest = options.allowRestFallback === true && ageSeconds <= MAX_CANDLE_AGE_SECONDS;
  const enough = closed.length >= MIN_CLOSED_CANDLES;
  const window = closed.slice(-MIN_CLOSED_CANDLES);
  const validOHLC = enough && window.every(c =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.close > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= c.low
  );
  const ordered = window.every((c, i) => i === 0 || c.epoch > window[i - 1].epoch);
  const reason = !enough ? `Insufficient closed M1 candles (${closed.length}/${MIN_CLOSED_CANDLES})`
    : !validOHLC ? "Invalid OHLC candle data"
    : !ordered ? "Candle timestamps are not strictly increasing"
    : ageSeconds > MAX_CANDLE_AGE_SECONDS ? "Latest closed candle is stale"
    : !stream && !rest ? "No fresh Streaming tick or permitted fresh REST fallback"
    : null;
  return {
    ready: !reason,
    reason,
    mode: stream ? "STREAMING" : rest ? "REST_FALLBACK" : "UNAVAILABLE",
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    lastCandleEpoch: last?.epoch ?? null,
    closed
  };
}

function historySignature(candles, mode) {
  let hash = 2166136261;
  for (const candle of candles.slice(-MIN_CLOSED_CANDLES)) {
    for (const value of [candle.epoch, candle.open, candle.high, candle.low, candle.close]) {
      const part = Number.isFinite(value) ? Math.round(value * 1e8) : 0;
      hash = Math.imul(hash ^ part, 16777619);
    }
  }
  return `${candles.at(-1)?.epoch ?? "none"}:${hash >>> 0}:${mode}`;
}

function startSimulationWorker(candles, options) {
  const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const resultBuffer = new SharedArrayBuffer(64 * 1024);
  const state = new Int32Array(signalBuffer);
  const worker = new Worker(new URL("./historical-analogue-worker.js", import.meta.url), {
    workerData: { candles, options, signalBuffer, resultBuffer }
  });
  worker.on("error", () => {});
  return { worker, state, resultBuffer, startedAt: Date.now() };
}

function finishSimulationWorker(job) {
  const wait = Atomics.wait(job.state, 0, 0, 3000);
  if (wait === "timed-out") {
    void job.worker.terminate();
    return { signal: "STANDBY", reason: "Historical assistant worker timed out", livePriceReady: false, evidence: [], metrics: null, executionMs: Date.now() - job.startedAt };
  }
  const length = Atomics.load(job.state, 1);
  const status = Atomics.load(job.state, 0);
  void job.worker.terminate();
  if (status !== 1 || length <= 0 || length > 64 * 1024) {
    return { signal: "STANDBY", reason: "Historical assistant worker failed", livePriceReady: false, evidence: [], metrics: null, executionMs: Date.now() - job.startedAt };
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(job.resultBuffer, 0, length)));
    if (!payload.ok) throw new Error(payload.error || "Worker error");
    return { ...payload.result, executionMs: Date.now() - job.startedAt };
  } catch (error) {
    return { signal: "STANDBY", reason: "Historical assistant result invalid: " + error.message, livePriceReady: false, evidence: [], metrics: null, executionMs: Date.now() - job.startedAt };
  }
}

function buildAssistant(simulation, originalSignal, executionMode) {
  const metrics = simulation.metrics || {};
  const up = Number.isFinite(metrics.upwardPercent) ? metrics.upwardPercent : null;
  const down = Number.isFinite(metrics.downwardPercent) ? metrics.downwardPercent : null;
  const historicalDirection = up === null || down === null
    ? "INSUFFICIENT_SAMPLE" : up > down ? "CALL" : down > up ? "PUT" : "NEUTRAL";
  const directionalSharePercent = historicalDirection === "CALL" ? up
    : historicalDirection === "PUT" ? down : null;
  const alignment = !["CALL", "PUT"].includes(originalSignal) ||
      !["CALL", "PUT"].includes(historicalDirection) ? "NO_COMPARISON"
    : originalSignal === historicalDirection ? "AGREES" : "CONFLICTS";
  const status = simulation.livePriceReady ? (up === null ? "LIMITED_SAMPLE" : "READY") : "UNAVAILABLE";
  const analogueCount = metrics.analoguesUsed ?? 0;
  const decisionReady = status === "READY" &&
    ["CALL", "PUT"].includes(historicalDirection) &&
    Number.isFinite(directionalSharePercent) &&
    directionalSharePercent >= 53 && analogueCount >= 12;
  return {
    role: "ADVISORY_AND_SAFETY_CHECK",
    status,
    decisionReady,
    executionMode,
    executionMs: simulation.executionMs ?? null,
    historicalDirection,
    directionalSharePercent,
    alignment,
    analogueCount,
    candidateCount: metrics.analogueCandidates ?? 0,
    patternCandles: metrics.patternCandles ?? 8,
    forecastHorizonCandles: metrics.forecastHorizonCandles ?? 1,
    meanSimilarityDistance: metrics.meanSimilarityDistance ?? null,
    interpretation: "Historical directional share is not a calibrated win probability.",
    reason: simulation.reason,
    evidence: simulation.evidence || [],
    metrics: simulation.metrics || null
  };
}

// The original market-context and strategy routing run on the main thread while
// the independent Historical Analogue worker runs. The original Decision Engine
// receives the assistant context and remains the only CALL/PUT/STANDBY authority.
export function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  const closed = gate.closed;
  let job = null, cachedSimulation = null, key = null;
  if (gate.ready) {
    key = historySignature(closed, gate.mode);
    if (simulationCache.key === key && simulationCache.result) cachedSimulation = simulationCache.result;
    else {
      try { job = startSimulationWorker(candles, options); }
      catch (error) {
        cachedSimulation = { signal: "STANDBY", reason: "Historical assistant unavailable: " + error.message, livePriceReady: false, evidence: [], metrics: null };
      }
    }
  }

  const prepared = prepareOriginalMarket(closed.slice(-MIN_CLOSED_CANDLES));

  let simulation, executionMode;
  if (!gate.ready) {
    simulation = { signal: "STANDBY", reason: gate.reason, livePriceReady: false, evidence: [], metrics: null };
    executionMode = "SOURCE_BLOCKED";
  } else if (cachedSimulation) {
    simulation = cachedSimulation;
    executionMode = simulationCache.key === key && simulationCache.result === cachedSimulation
      ? "CACHED_WORKER_RESULT" : "WORKER_UNAVAILABLE";
  } else {
    simulation = finishSimulationWorker(job);
    executionMode = "PARALLEL_WORKER_THREAD";
    if (simulation.livePriceReady) simulationCache = { key, result: simulation };
  }

  const assistantForDecision = buildAssistant(simulation, prepared.candidate?.signal || "STANDBY", executionMode);
  const original = finalizeOriginalMarket(prepared, assistantForDecision);
  const assistant = buildAssistant(simulation, original.signal, executionMode);
  const signal = gate.ready ? original.signal : "STANDBY";

  return {
    ...original,
    signal,
    reason: gate.ready ? original.reason : gate.reason,
    assistant,
    lastCandleEpoch: gate.lastCandleEpoch,
    dataMode: gate.mode,
    ageSeconds: gate.ageSeconds,
    livePriceReady: gate.ready,
    closedCandleCount: closed.length,
    requiredCandles: MIN_CLOSED_CANDLES
  };
}
