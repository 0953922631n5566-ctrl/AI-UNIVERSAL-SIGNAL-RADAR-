'use strict';

const { buildMarketContext } = require('../scanner/market-context');
const CONTEXT_CANDLES = 50;
const ENTRY_CANDLES = 4;
const ANALYSIS_CANDLES = CONTEXT_CANDLES + ENTRY_CANDLES;
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');
const { evaluateAllEngines } = require('./multi-engine-dispatcher');

function prepareMarket(candles) {
  const window = Array.isArray(candles) ? candles.slice(-ANALYSIS_CANDLES) : [];
  const contextCandles = window.slice(0, CONTEXT_CANDLES);
  const entryCandles = window.slice(-ENTRY_CANDLES);
  const context = buildMarketContext(contextCandles);
  const candidate = routeStrategy({ ...context, candles: window, contextCandles, entryCandles });
  return { context, candidate, analysisWindow: { contextCandles: contextCandles.length, entryCandles: entryCandles.length, total: window.length } };
}

function finalizeMarket(prepared) {
  const context = prepared?.context || {};
  const candidate = prepared?.candidate || null;
  const decision = decide(context, candidate);
  return {
    ...decision,
    reason: decision.reason || context.reason,
    indicators: context.indicators || null,
    higherTimeframe: context.higherTimeframe || null,
    regimeConfidence: context.confidence || 0,
    engineResults: candidate?.engineResults || null,
    engineSummary: candidate?.engineSummary || null,
    analysisWindow: prepared?.analysisWindow || { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES, total: ANALYSIS_CANDLES }
  };
}

/**
 * Main production decision path: build one shared market context, evaluate all
 * nine directional strategy engines concurrently; system 10 aggregates their
 * weighted votes. Independent source/data-quality and Safety Noise Guard checks
 * remain vetoes, while legacy directional re-filtering is bypassed for the aggregate.
 */
async function analyzeMarketMulti(candles, options = {}) {
  const window = Array.isArray(candles) ? candles.slice(-ANALYSIS_CANDLES) : [];
  const contextCandles = window.slice(0, CONTEXT_CANDLES);
  const entryCandles = window.slice(-ENTRY_CANDLES);
  const context = buildMarketContext(contextCandles);
  const candidate = await evaluateAllEngines({
    ...context, candles: window, contextCandles, entryCandles,
    now: options.now, tickAgeSeconds: options.tickAgeSeconds,
    allowRestFallback: options.allowRestFallback, ageSeconds: options.ageSeconds
  });
  return finalizeMarket({ context, candidate,
    analysisWindow: { contextCandles: contextCandles.length, entryCandles: entryCandles.length, total: window.length } });
}

// Synchronous legacy helpers remain available for deterministic diagnostics/tests;
// the live backend uses analyzeMarketMulti exclusively.
function analyzeMarket(candles) {
  return finalizeMarket(prepareMarket(candles));
}

module.exports = { analyzeMarket, analyzeMarketMulti, prepareMarket, finalizeMarket };
