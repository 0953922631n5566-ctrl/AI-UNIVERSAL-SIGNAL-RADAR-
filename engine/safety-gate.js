'use strict';
const { ROUND16 } = require('./round16-parameters');

function standby(decision, simulation, reason, status) {
  return {
    ...decision,
    signal: 'STANDBY',
    reason,
    safetyGate: { status: status || 'BLOCKED', passed: false },
    simulation: {
      ready: simulation?.ready === true,
      status: simulation?.status || 'NOT_READY',
      reason: simulation?.reason || reason
    }
  };
}

function applySafetyGate(decision, simulation, candleTime) {
  if (!decision || !['CALL', 'PUT', 'STANDBY'].includes(decision.signal)) {
    return standby({ signal: 'STANDBY', score: 0, strategy: 'NONE' }, simulation,
      'Decision Engine returned an invalid signal', 'INVALID_DECISION');
  }
  if (decision.signal === 'STANDBY') {
    return {
      ...decision,
      safetyGate: { status: 'PASSIVE', passed: false },
      simulation: {
        ready: simulation?.ready === true,
        status: simulation?.status || 'NOT_READY',
        reason: simulation?.reason || 'No directional candidate to authorize'
      }
    };
  }
  if (simulation?.ready !== true) {
    return standby(decision, simulation,
      simulation?.reason || 'Simulation not ready; directional signal blocked',
      'SIMULATION_NOT_READY');
  }
  if (simulation.candleTime !== candleTime) {
    return standby(decision, simulation, 'Simulation candle does not match the analyzed closed candle',
      'CANDLE_MISMATCH');
  }
  if (simulation.signal !== decision.signal) {
    return standby(decision, simulation, 'Simulation direction does not confirm Decision Engine',
      'DIRECTION_MISMATCH');
  }

  const p = ROUND16;
  const failures = [];
  if (simulation.riskScore > p.riskMax) failures.push('Risk exceeds 0.70');
  if (simulation.volatilityRatio > p.volatilityRatioMax) failures.push('Volatility exceeds 1.50');
  if (simulation.adx < p.weakAdxMin) failures.push('ADX is weak (below 22)');
  if (simulation.rangeAtrRatio > p.rangeAtrRatioMax) failures.push('Range/ATR exceeds 1.25');

  if (failures.length) return standby(decision, simulation, failures.join('; '), 'PARAMETER_BLOCKED');
  return {
    ...decision,
    safetyGate: { status: 'PASSED', passed: true },
    simulation: { ready: true, status: 'READY', reason: 'Simulation confirmed all Round 16 gates' }
  };
}

module.exports = { applySafetyGate };
