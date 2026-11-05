'use strict';
function createSignalCache(){let entry=null;return{get(key){return entry&&entry.key===key?entry.value:null;},set(key,value){entry={key,value,computedAt:Date.now()};return value;},clear(){entry=null;}};}
module.exports={createSignalCache};
