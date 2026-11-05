'use strict';
const { buildMarketContext } = require('../scanner/market-context');
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');

function prepareMarket(candles) {
  const context = buildMarketContext(candles);
  const candidate = routeStrategy(context);
  return { context, candidate };
}

function finalizeMarket(prepared, assistant = null) {
  const context = prepared?.context || {};
  const candidate = prepared?.candidate || null;
  if (assistant) context.assistant = assistant;
  const decision = decide(context, candidate);
  return {
    ...decision,
    reason: decision.reason || context.reason,
    indicators: context.indicators || null,
    regimeConfidence: context.confidence || 0,
    assistant: assistant || null
  };
}

function analyzeMarket(candles, assistant = null) {
  return finalizeMarket(prepareMarket(candles), assistant);
}

module.exports = { analyzeMarket, prepareMarket, finalizeMarket };
