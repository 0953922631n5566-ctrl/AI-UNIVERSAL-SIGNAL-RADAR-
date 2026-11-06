'use strict';

const { buildMarketContext } = require('../scanner/market-context');
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');

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
    regimeConfidence: context.confidence || 0
  };
}

function analyzeMarket(candles) {
  return finalizeMarket(prepareMarket(candles));
}

module.exports = { analyzeMarket, prepareMarket, finalizeMarket };
