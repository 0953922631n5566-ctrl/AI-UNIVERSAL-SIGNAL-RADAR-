'use strict';
function volatility(c,n=20){if(!Array.isArray(c)||c.length<n)return null;const a=c.slice(-n).map(x=>x.high-x.low),avg=a.reduce((s,x)=>s+x,0)/n;return{averageRange:avg,currentRange:a[a.length-1],ratio:a[a.length-1]/Math.max(avg,1e-12)};}
module.exports={volatility};
