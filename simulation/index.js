'use strict';
const {
  simulateFuture, calculateAtr, calculateMomentum,
  DEFAULT_HORIZONS_SECONDS, HORIZONS_SECONDS
} = require('./future-simulation-engine');
const { projectFuture } = require('./projection-engine');
const { analyzeWithProjection } = require('./decision-adapter');
const {
  applySimulationSafetyGate, DEFAULT_MAX_REVERSAL_RISK
} = require('./simulation-safety-gate');

module.exports = {
  simulateFuture, calculateAtr, calculateMomentum,
  DEFAULT_HORIZONS_SECONDS, HORIZONS_SECONDS,
  projectFuture, analyzeWithProjection,
  applySimulationSafetyGate, DEFAULT_MAX_REVERSAL_RISK
};
