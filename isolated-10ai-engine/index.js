'use strict';

const { evaluateAllEngines, evaluateEngineBatch, centralDispatcher } = require('./src/multi-engine-dispatcher');
const { decide } = require('./src/decision-engine');

/**
 * Standalone adapter. marketData contains candles, indicators, regime and freshness fields.
 * marketContext is supplied by the host scanner; this package does not fetch market data.
 */
async function analyze(marketData, marketContext = marketData) {
  const candidate = await evaluateAllEngines(marketData);
  const decision = decide(marketContext, candidate);
  return { ...decision, engineResults: candidate.engineResults, engineSummary: candidate.engineSummary };
}

const { createVisionAnalyzeHandler } = require('./src/vision-input-gateway');
const { createOpenAIVisionAdapter, validateExtraction, VisionExtractionError } = require('./src/vision-adapter');

module.exports = { analyze, evaluateAllEngines, evaluateEngineBatch, centralDispatcher, decide, createVisionAnalyzeHandler, createOpenAIVisionAdapter, validateExtraction, VisionExtractionError };
