'use strict';
const { analyzeMarket } = require('./analyze-market');
const { readSimulationResult } = require('./simulation-adapter');
const { simulateNextCandle } = require('./future-simulation');
const { applySafetyGate } = require('./safety-gate');
const { ROUND16 } = require('./round16-parameters');
function analyzeMainMarket(candles,options={}){
 const analysis=analyzeMarket(candles),latest=Array.isArray(candles)?candles.at(-1):null;
 const candleTime=Number.isFinite(latest?.time)?latest.time:null;
 const runner=options.simulationRunner||((ctx)=>simulateNextCandle(ctx.candles,ctx.analysis));
 const simulation=readSimulationResult({market:'MAIN',symbol:'EUR/USD',timeframe:'M1',candles,analysis,parameters:ROUND16},runner);
 const gated=applySafetyGate(analysis,simulation,candleTime);
 return{...gated,regime:analysis.regime,regimeConfidence:analysis.regimeConfidence,
  indicators:analysis.indicators,parameters:{round:ROUND16.round,evaluationIntervalMs:ROUND16.evaluationIntervalMs,
  minAnalogueCount:ROUND16.minAnalogueCount,minDirectionalRate:ROUND16.minDirectionalRate,
  riskMax:ROUND16.riskMax,volatilityRatioMax:ROUND16.volatilityRatioMax}};
}
module.exports={analyzeMainMarket};
