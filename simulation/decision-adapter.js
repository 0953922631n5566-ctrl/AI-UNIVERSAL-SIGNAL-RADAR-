'use strict';

// Research-only bridge to the existing Decision Engine.
// The existing CALL/PUT/STANDBY decision remains authoritative; projections
// are attached as diagnostics and are not allowed to change the signal.
const { analyzeMarket } = require('../engine/analyze-market');
const { simulateFuture } = require('./future-simulation-engine');
const { projectFuture } = require('./projection-engine');

function analyzeWithProjection(candles, options = {}) {
  const decision = analyzeMarket(candles);
  const simulation = simulateFuture(candles, decision.indicators || {}, options.simulation || {});
  const projection = projectFuture(simulation, options.projection || {});
  return {
    ...decision,
    futureSimulation: simulation,
    projection,
    projectionMode: 'DIAGNOSTIC_ONLY'
  };
}

module.exports = { analyzeWithProjection };
