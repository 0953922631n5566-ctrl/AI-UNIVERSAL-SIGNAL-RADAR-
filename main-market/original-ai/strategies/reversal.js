'use strict';
function evaluateReversal(x){const i=x.indicators,c=x.latest,p=x.candles.at(-2);if(!i||!c||!p)return{signal:'STANDBY',score:0,reason:'Missing reversal context'};if(c.close>p.high&&c.close>c.open&&i.macdHistogram>0&&i.rsi>=50)return{signal:'CALL',score:80,reason:'Bullish break of structure confirmed'};if(c.close<p.low&&c.close<c.open&&i.macdHistogram<0&&i.rsi<=50)return{signal:'PUT',score:80,reason:'Bearish break of structure confirmed'};return{signal:'STANDBY',score:24,reason:'Reversal confirmation incomplete'};}
module.exports={evaluateReversal};
