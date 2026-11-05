'use strict';

// The future-simulation provider is deliberately not fabricated here.
// Until a real provider is connected, readiness remains false and Safety Gate
// must keep all directional signals at STANDBY.
function readSimulationResult(context, simulationRunner) {
  if (typeof simulationRunner !== 'function') {
    return {
      ready: false,
      status: 'NOT_CONFIGURED',
      reason: 'Future Simulation is not connected'
    };
  }

  try {
    const result = simulationRunner(context);
    if (!result || result.ready !== true) {
      return {
        ready: false,
        status: result?.status || 'NOT_READY',
        reason: result?.reason || 'Future Simulation is not ready'
      };
    }
    const required = ['riskScore', 'volatilityRatio', 'adx', 'rangeAtrRatio'];
    if (!['CALL', 'PUT', 'STANDBY'].includes(result.signal) ||
        required.some(key => !Number.isFinite(result[key])) ||
        !Number.isFinite(result.candleTime)) {
      return {
        ready: false,
        status: 'INVALID_RESULT',
        reason: 'Future Simulation result is incomplete or invalid'
      };
    }
    return { ...result, ready: true, status: 'READY' };
  } catch (error) {
    return {
      ready: false,
      status: 'ERROR',
      reason: String(error?.message || 'Future Simulation failed').slice(0, 160)
    };
  }
}

module.exports = { readSimulationResult };
