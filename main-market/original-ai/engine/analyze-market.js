'use strict';

const { buildMarketContext } = require('../scanner/market-context');
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');

function prepareMarket(candles) {
  const context = buildMarketContext(candles);
  const candidate = routeStrategy(context);
  return { context, candidate };
}

// Historical Analogue is metadata only. It is deliberately not passed into
// decide(), so it cannot alter the Original AI's signal, score, or safety gates.
function buildAssistantMetadata(assistant, signal) {
  if (!assistant) return null;
  const historical = assistant.historicalDirection || 'INSUFFICIENT_SAMPLE';
  const comparable = ['CALL', 'PUT'].includes(signal) &&
    ['CALL', 'PUT'].includes(historical);
  return {
    ...assistant,
    role: 'ADVISORY_ONLY',
    alignment: comparable ? (signal === historical ? 'AGREES' : 'CONFLICTS') : 'NO_COMPARISON'
  };
}

function finalizeMarket(prepared, assistant = null) {
  const context = prepared?.context || {};
  const candidate = prepared?.candidate || null;
  const decision = decide(context, candidate);
  const assistantMetadata = buildAssistantMetadata(assistant, decision.signal);
  return {
    ...decision,
    reason: decision.reason || context.reason,
    indicators: context.indicators || null,
    regimeConfidence: context.confidence || 0,
    assistant: assistantMetadata,
    // Compatibility diagnostics for existing API/tests; never used to decide the signal.
    assistantAlignment: assistantMetadata?.alignment || 'NO_COMPARISON',
    assistantHistoricalDirection: assistantMetadata?.historicalDirection || 'INSUFFICIENT_SAMPLE'
  };
}

function analyzeMarket(candles, assistant = null) {
  return finalizeMarket(prepareMarket(candles), assistant);
}

module.exports = { analyzeMarket, prepareMarket, finalizeMarket };
