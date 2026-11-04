'use strict';
const{evaluateTrendContinuation}=require('./trend-continuation');
function evaluateUptrend(x){return evaluateTrendContinuation(x,'CALL');}
module.exports={evaluateUptrend};
