'use strict';
const{evaluateTrendContinuation}=require('./trend-continuation');
function evaluateDowntrend(x){return evaluateTrendContinuation(x,'PUT');}
module.exports={evaluateDowntrend};
