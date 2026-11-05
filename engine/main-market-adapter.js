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
 return{...gated,parameters:{round:ROUND16.round,evaluationIntervalMs:ROUND16.evaluationIntervalMs,
  riskMax:ROUND16.riskMax,volatilityRatioMax:ROUND16.volatilityRatioMax,weakAdxMin:ROUND16.weakAdxMin,rangeAtrRatioMax:ROUND16.rangeAtrRatioMax}};
}
module.exports={analyzeMainMarket};
