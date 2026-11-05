'use strict';

// Round 16 operating profile. Values are gates, not predictive guarantees.
const ROUND16 = Object.freeze({
  round: 16,
  evaluationIntervalMs: 30000,
  riskMax: 0.70,
  volatilityRatioMax: 1.50,
  weakAdxMin: 22,
  rangeAtrRatioMax: 1.25
});

module.exports = { ROUND16 };
