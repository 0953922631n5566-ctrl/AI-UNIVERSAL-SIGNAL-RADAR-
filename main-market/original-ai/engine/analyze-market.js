'use strict';

const { buildMarketContext } = require('../scanner/market-context');
const { routeStrategy } = require('./strategy-router');
const { decide } = require('./decision-engine');

function prepareMarket(candles) {
  const context = buildMarketContext(candles);
  const candidate = routeStrategy(context);
  return { context, candidate };
}

function buildAssistantMetadata(assistant, signal) {
  if (!assistant) return null;
  const historical = assistant.historicalDirection || 'INSUFFICIENT_SAMPLE';
  const comparable = ['CALL', 'PUT'].includes(signal) &&
    ['CALL', 'PUT'].includes(historical);
  return {
    ...assistant,
    role: 'ADVISORY_AND_SAFETY_CHECK',
    alignment: comparable ? (signal === historical ? 'AGREES' : 'CONFLICTS') : 'NO_COMPARISON'
  };
}

function finalizeMarket(prepared, assistant = null) {
  const originalContext = prepared?.context || {};
  const candidate = prepared?.candidate || null;
  // Only a validated, sufficiently sampled historical result enters the Original AI.
  // The Decision Engine can use it as a conservative conflict check; it cannot generate signals.
  const context = {
    ...originalContext,
    historicalAssistant: assistant?.decisionReady === true ? {
      decisionReady: true,
      direction: assistant.historicalDirection,
      directionalSharePercent: assistant.directionalSharePercent,
      analogueCount: assistant.analogueCount
    } : null
  };
  const decision = decide(context, candidate);
  const assistantMetadata = buildAssistantMetadata(assistant, decision.signal);
  return {
    ...decision,
    reason: decision.reason || context.reason,
    indicators: context.indicators || null,
    regimeConfidence: context.confidence || 0,
    assistant: assistantMetadata,
    assistantAlignment: assistantMetadata?.alignment || 'NO_COMPARISON',
    assistantHistoricalDirection: assistantMetadata?.historicalDirection || 'INSUFFICIENT_SAMPLE'
  };
}

function analyzeMarket(candles, assistant = null) {
  return finalizeMarket(prepareMarket(candles), assistant);
}

module.exports = { analyzeMarket, prepareMarket, finalizeMarket };
