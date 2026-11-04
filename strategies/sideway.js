'use strict';
function evaluateSideway(x){const i=x.indicators,c=x.latest;if(!i||!c)return{signal:'STANDBY',score:0,reason:'Missing range context'};if(i.nearSupport&&c.close>c.open&&i.rsi<=48)return{signal:'CALL',score:80,reason:'Support bounce confirmed'};if(i.nearResistance&&c.close<c.open&&i.rsi>=52)return{signal:'PUT',score:80,reason:'Resistance rejection confirmed'};return{signal:'STANDBY',score:32,reason:'No confirmed range-boundary entry'};}
module.exports={evaluateSideway};
