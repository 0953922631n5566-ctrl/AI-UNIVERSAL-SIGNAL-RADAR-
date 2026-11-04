'use strict';
function rsi(a,n=14){if(!Array.isArray(a)||a.length<=n)return null;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}if(!l)return g?100:50;if(!g)return 0;return 100-100/(1+g/l);}
module.exports={rsi};
