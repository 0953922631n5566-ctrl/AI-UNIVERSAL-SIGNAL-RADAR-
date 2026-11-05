'use strict';
const{scanTrend}=require('./trend-scanner');
function buildMarketContext(candles){return{...scanTrend(candles),candles,latest:candles?.at(-1)||null};}
module.exports={buildMarketContext};
