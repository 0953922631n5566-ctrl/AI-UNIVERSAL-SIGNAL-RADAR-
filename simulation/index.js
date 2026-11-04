'use strict';
const { simulateFuture, calculateAtr, HORIZONS_SECONDS } = require('./future-simulation-engine');
const { applySimulationSafetyGate, DEFAULT_MAX_REVERSAL_RISK } = require('./simulation-safety-gate');
module.exports = { simulateFuture, calculateAtr, HORIZONS_SECONDS, applySimulationSafetyGate, DEFAULT_MAX_REVERSAL_RISK };
