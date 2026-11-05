'use strict';
const{evaluateUptrend}=require('../strategies/uptrend'),{evaluateDowntrend}=require('../strategies/downtrend'),{evaluateSideway}=require('../strategies/sideway'),{evaluateReversal}=require('../strategies/reversal');
const routes={UPTREND:evaluateUptrend,DOWNTREND:evaluateDowntrend,SIDEWAY:evaluateSideway,REVERSAL:evaluateReversal};
function routeStrategy(ctx){const fn=routes[ctx?.regime];if(!fn)return{strategy:'NONE',signal:'STANDBY',score:0,reason:'Market regime UNCLEAR; strategy execution blocked'};return{strategy:ctx.regime,...fn(ctx)};}
module.exports={routeStrategy};
