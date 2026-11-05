'use strict';
const { ROUND16 } = require('./round16-parameters');
function simulationSummary(s){
 if(!s)return{ready:false,status:'NOT_READY'};
 const fields=['sampleCount','probabilityUp','probabilityDown','expectedMoveAtr','medianMoveAtr','nearestAnalogueDistance','horizonCandles','model','riskScore','volatilityRatio','adx','rangeAtrRatio'];
 const out={ready:s.ready===true,status:s.status||'NOT_READY'};
 for(const k of fields)if(Number.isFinite(s[k])||typeof s[k]==='string')out[k]=s[k];
 out.reason=s.reason||'';return out;
}
function standby(decision,simulation,reason,status){return{...decision,signal:'STANDBY',reason,safetyGate:{status:status||'BLOCKED',passed:false},simulation:simulationSummary(simulation)};}
function applySafetyGate(decision,simulation,candleTime){
 if(!decision||!['CALL','PUT','STANDBY'].includes(decision.signal))return standby({signal:'STANDBY',score:0,strategy:'NONE'},simulation,'Decision Engine returned an invalid signal','INVALID_DECISION');
 if(decision.signal==='STANDBY')return{...decision,safetyGate:{status:'PASSIVE',passed:false},simulation:simulationSummary(simulation)};
 if(simulation?.ready!==true)return standby(decision,simulation,simulation?.reason||'Simulation not ready; directional signal blocked','SIMULATION_NOT_READY');
 if(simulation.candleTime!==candleTime)return standby(decision,simulation,'Simulation candle does not match analyzed closed candle','CANDLE_MISMATCH');
 if(simulation.signal!==decision.signal)return standby(decision,simulation,'Historical simulation direction does not confirm Decision Engine','DIRECTION_MISMATCH');
 const p=ROUND16,fail=[];
 if(simulation.riskScore>p.riskMax)fail.push('Risk exceeds 0.70');
 if(simulation.volatilityRatio>p.volatilityRatioMax)fail.push('Volatility exceeds 1.50');
 if(simulation.adx<p.weakAdxMin)fail.push('ADX is weak (below 22)');
 if(simulation.rangeAtrRatio>p.rangeAtrRatioMax)fail.push('Range/ATR exceeds 1.25');
 if(fail.length)return standby(decision,simulation,fail.join('; '),'PARAMETER_BLOCKED');
 return{...decision,safetyGate:{status:'PASSED',passed:true},simulation:simulationSummary(simulation)};
}
module.exports={applySafetyGate,simulationSummary};
