'use strict';
function ema(a,n){if(!Array.isArray(a)||a.length<n||n<1)return null;const k=2/(n+1);let v=a.slice(0,n).reduce((x,y)=>x+y,0)/n;for(let i=n;i<a.length;i++)v=a[i]*k+v*(1-k);return v;}
module.exports={ema};
