'use strict';
const{buildMarketContext}=require('../scanner/market-context');
const{routeStrategy}=require('./strategy-router');
const{decide}=require('./decision-engine');
function analyzeMarket(candles){const context=buildMarketContext(candles);const candidate=routeStrategy(context);const decision=decide(context,candidate);return{...decision,reason:decision.reason||context.reason,indicators:context.indicators||null,regimeConfidence:context.confidence||0};}
module.exports={analyzeMarket};
