'use strict';

// Round 16 adaptive profile: simulation-led entry with hard protection only
// against weak directional edge, excessive adverse outcomes, and extreme volatility.
const ROUND16 = Object.freeze({
  round: 16,
  evaluationIntervalMs: 30000,
  minAnalogueCount: 20,
  minDirectionalRate: 0.58,
  riskMax: 0.70,
  volatilityRatioMax: 2.20
});

module.exports = { ROUND16 };
