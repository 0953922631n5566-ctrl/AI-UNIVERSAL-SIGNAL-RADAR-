'use strict';
function supportResistance(c,n=30){if(!Array.isArray(c)||c.length<n+1)return null;const a=c.slice(-(n+1),-1);return{support:Math.min(...a.map(x=>x.low)),resistance:Math.max(...a.map(x=>x.high))};}
module.exports={supportResistance};
