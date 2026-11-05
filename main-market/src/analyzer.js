import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { simulateHistoricalAnalogues } from "./historical-analogue.js";
import { MIN_CLOSED_CANDLES, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS } from "./config.js";

const require = createRequire(import.meta.url);
const { analyzeMarket: analyzeOriginalMarket } = require("../original-ai/engine/analyze-market.js");
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
  return {
    ready: Boolean(last && ageSeconds <= MAX_CANDLE_AGE_SECONDS && (stream || rest)),
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
  return { worker, state, resultBuffer, startedAt: Date.now() };
}

function finishSimulationWorker(job) {
  const wait = Atomics.wait(job.state, 0, 0, 5000);
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
  return {
    role: "ADVISORY_ONLY",
    status: simulation.livePriceReady ? (up === null ? "LIMITED_SAMPLE" : "READY") : "UNAVAILABLE",
    executionMode,
    executionMs: simulation.executionMs ?? null,
    historicalDirection,
    directionalSharePercent,
    alignment,
    analogueCount: metrics.analoguesUsed ?? 0,
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

// Original AI is evaluated on the main thread while historical simulation runs
// in a worker thread. The assistant is cached per closed-candle history and can
// never replace or override the Original AI's directional decision.
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

  // This work runs while the independent historical assistant worker is active.
  const original = analyzeOriginalMarket(closed.slice(-MIN_CLOSED_CANDLES));

  let simulation, executionMode;
  if (!gate.ready) {
    simulation = { signal: "STANDBY", reason: "No fresh Streaming tick or permitted fresh REST fallback", livePriceReady: false, evidence: [], metrics: null };
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

  const signal = gate.ready ? original.signal : "STANDBY";
  const assistant = buildAssistant(simulation, original.signal, executionMode);
  return {
    ...original,
    signal,
    reason: gate.ready ? original.reason : simulation.reason,
    assistant,
    lastCandleEpoch: gate.lastCandleEpoch,
    dataMode: gate.mode,
    ageSeconds: gate.ageSeconds,
    livePriceReady: gate.ready,
    closedCandleCount: closed.length,
    requiredCandles: MIN_CLOSED_CANDLES
  };
}
