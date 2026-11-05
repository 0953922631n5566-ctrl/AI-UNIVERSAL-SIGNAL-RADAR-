'use strict';

// Converts deterministic scenario envelopes into a compact projection summary.
// Bounds are scenario ranges, NOT statistical confidence intervals or guarantees.
function projectFuture(simulation, options = {}) {
  if (!simulation || simulation.status !== 'READY' ||
      !Number.isFinite(simulation.basePrice) ||
      !Number.isFinite(simulation.momentum) ||
      !Array.isArray(simulation.scenarios) || !simulation.scenarios.length) {
    return {
      status: 'UNAVAILABLE',
      direction: 'NEUTRAL',
      uncertainty: 'HIGH',
      reason: 'Future simulation is unavailable or incomplete',
      horizons: []
    };
  }

  const maxRisk = Number.isFinite(options.highRiskThreshold) ? options.highRiskThreshold : 0.72;
  const mediumRisk = Number.isFinite(options.mediumRiskThreshold) ? options.mediumRiskThreshold : 0.48;
  const directionThreshold = Number.isFinite(options.directionThreshold) ? options.directionThreshold : 0.08;
  const direction = simulation.momentum > directionThreshold ? 'UP'
    : simulation.momentum < -directionThreshold ? 'DOWN' : 'NEUTRAL';

  const uncertainty = simulation.reversalRisk >= maxRisk ? 'HIGH'
    : simulation.reversalRisk >= mediumRisk || simulation.volatilityRatio >= 2 ? 'MEDIUM' : 'LOW';

  const horizons = simulation.scenarios.map(s => {
    if (![s.seconds, s.basePrice, s.lowerBound, s.upperBound, s.continuationPrice]
      .every(Number.isFinite) || s.lowerBound > s.upperBound) return null;
    return {
      seconds: s.seconds,
      basePrice: s.basePrice,
      projectedDirection: direction,
      lowerBound: s.lowerBound,
      upperBound: s.upperBound,
      continuationPrice: s.continuationPrice,
      rangeWidth: s.upperBound - s.lowerBound
    };
  }).filter(Boolean);

  if (horizons.length !== simulation.scenarios.length) {
    return { status: 'UNAVAILABLE', direction: 'NEUTRAL', uncertainty: 'HIGH',
      reason: 'One or more projection scenarios are invalid', horizons: [] };
  }

  return {
    status: 'READY',
    model: 'ATR_SCENARIO_PROJECTION_V1',
    asOf: simulation.asOf ?? null,
    basePrice: simulation.basePrice,
    direction,
    uncertainty,
    reversalRisk: simulation.reversalRisk,
    volatilityRatio: simulation.volatilityRatio,
    horizons,
    interpretation: 'Deterministic scenario envelope only; no calibrated probability is implied.'
  };
}

module.exports = { projectFuture };
