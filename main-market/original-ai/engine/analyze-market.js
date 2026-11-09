'use strict';

const { buildMarketContext } = require('../scanner/market-context');
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');
const { evaluateAllEngines } = require('./multi-engine-dispatcher');

function prepareMarket(candles) {
  const context = buildMarketContext(candles);
  const candidate = routeStrategy(context);
  return { context, candidate };
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
    engineSummary: candidate?.engineSummary || null
  };
}

/**
 * Main production decision path: build one shared market context, evaluate all
 * nine directional strategy engines concurrently; system 10 aggregates their
 * weighted votes. Independent source/data-quality and Safety Noise Guard checks
 * remain vetoes, while legacy directional re-filtering is bypassed for the aggregate.
 */
async function analyzeMarketMulti(candles, options = {}) {
  const context = buildMarketContext(candles);
  const candidate = await evaluateAllEngines({
    ...context,
    candles,
    now: options.now,
    tickAgeSeconds: options.tickAgeSeconds,
    allowRestFallback: options.allowRestFallback,
    ageSeconds: options.ageSeconds
  });
  return finalizeMarket({ context, candidate });
}

// Synchronous legacy helpers remain available for deterministic diagnostics/tests;
// the live backend uses analyzeMarketMulti exclusively.
function analyzeMarket(candles) {
  return finalizeMarket(prepareMarket(candles));
}

module.exports = { analyzeMarket, analyzeMarketMulti, prepareMarket, finalizeMarket };
