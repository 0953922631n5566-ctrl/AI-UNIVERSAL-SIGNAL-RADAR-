'use strict';
const {ema}=require('./ema');
function macd(a){if(!Array.isArray(a)||a.length<35)return null;const line=ema(a,12)-ema(a,26),h=[];for(let i=26;i<=a.length;i++)h.push(ema(a.slice(0,i),12)-ema(a.slice(0,i),26));const signal=ema(h,9);return signal===null?null:{line,signal,histogram:line-signal};}
module.exports={macd};
