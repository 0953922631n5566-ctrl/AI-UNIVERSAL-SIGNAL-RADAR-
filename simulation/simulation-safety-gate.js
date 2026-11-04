'use strict';

// Pure adapter: does not fetch data, mutate the Decision Engine, or perform I/O.
// Fail-closed behavior is intentional when simulation is explicitly enabled.
const DEFAULT_MAX_REVERSAL_RISK = 0.72;

function applySimulationSafetyGate(decision, simulation, options = {}) {
  if (!decision || !['CALL', 'PUT'].includes(decision.signal)) return decision;
  const maxRisk = Number.isFinite(options.maxReversalRisk)
    ? options.maxReversalRisk : DEFAULT_MAX_REVERSAL_RISK;

  if (!simulation || simulation.status !== 'READY' ||
      !Number.isFinite(simulation.reversalRisk)) {
    return {
      ...decision,
      signal: 'STANDBY',
      reason: 'Future simulation unavailable; safety gate fail-closed',
      simulationGate: 'BLOCKED_UNAVAILABLE'
    };
  }

  const adverseDirection = (decision.signal === 'CALL' && simulation.direction === 'DOWN') ||
    (decision.signal === 'PUT' && simulation.direction === 'UP');
  if (simulation.reversalRisk >= maxRisk || adverseDirection && simulation.reversalRisk >= maxRisk * 0.7) {
    return {
      ...decision,
      signal: 'STANDBY',
      reason: 'Future simulation indicates elevated reversal/fakeout risk',
      simulationGate: 'BLOCKED_REVERSAL_RISK'
    };
  }

  return { ...decision, simulationGate: 'PASSED' };
}

module.exports = { applySimulationSafetyGate, DEFAULT_MAX_REVERSAL_RISK };
