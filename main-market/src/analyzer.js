import { createRequire } from "node:module";
import { simulateHistoricalAnalogues } from "./historical-analogue.js";
import { MIN_CLOSED_CANDLES } from "./config.js";

const require = createRequire(import.meta.url);
const { analyzeMarket: analyzeOriginalMarket } = require("../original-ai/engine/analyze-market.js");

function buildAssistant(simulation, originalSignal) {
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

// The archived Original AI remains the sole CALL/PUT/STANDBY decision-maker.
// Historical simulation runs as an independent advisory pass; it never replaces
// or overrides a valid Original AI direction. Source-quality failures still fail closed.
export function analyzeMarket(candles, options = {}) {
  const closed = Array.isArray(candles)
    ? candles.filter(c => c && c.live !== true && Number.isFinite(c.epoch))
    : [];
  const original = analyzeOriginalMarket(closed.slice(-MIN_CLOSED_CANDLES));
  const simulation = simulateHistoricalAnalogues(candles, options);
  const sourceReady = simulation.livePriceReady === true;
  const signal = sourceReady ? original.signal : "STANDBY";
  const assistant = buildAssistant(simulation, original.signal);
  return {
    ...original,
    signal,
    reason: sourceReady ? original.reason : simulation.reason,
    assistant,
    lastCandleEpoch: simulation.lastCandleEpoch ?? closed.at(-1)?.epoch ?? null,
    dataMode: simulation.dataMode || "UNAVAILABLE",
    ageSeconds: simulation.ageSeconds ?? null,
    livePriceReady: sourceReady,
    closedCandleCount: closed.length,
    requiredCandles: MIN_CLOSED_CANDLES
  };
}
