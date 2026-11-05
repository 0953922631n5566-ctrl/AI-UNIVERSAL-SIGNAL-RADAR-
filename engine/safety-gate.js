'use strict';
const { ROUND16 } = require('./round16-parameters');
function simulationSummary(s){
 if(!s)return{ready:false,status:'NOT_READY'};
 const fields=['projectionBar','signal','sampleCount','probabilityUp','probabilityDown','currentPrice','currentAtr','expectedMovePrice','projectedPrice','expectedMoveAtr','medianMoveAtr','nearestAnalogueDistance','horizonCandles','model','riskScore','volatilityRatio','adx','rangeAtrRatio'];
 const out={ready:s.ready===true,status:s.status||'NOT_READY'};
 for(const k of fields)if(Number.isFinite(s[k])||typeof s[k]==='string')out[k]=s[k];
 out.reason=s.reason||'';return out;
}
function standby(decision,simulation,reason,status){return{...decision,signal:'STANDBY',reason,safetyGate:{status:status||'BLOCKED',passed:false},simulation:simulationSummary(simulation)};}

// Simulation is the primary directional decision. The original strategy result
// remains useful as regime/context diagnostics, but it no longer vetoes a valid
// historical-analogue direction merely because its indicator checklist disagrees.
function applySafetyGate(decision,simulation,candleTime){
 const base=decision&&typeof decision==='object'?decision:{signal:'STANDBY',score:0,strategy:'NONE'};
 if(simulation?.ready!==true)return standby(base,simulation,simulation?.reason||'Future Simulation is not ready','SIMULATION_NOT_READY');
 if(!Number.isFinite(candleTime)||simulation.candleTime!==candleTime)
  return standby(base,simulation,'Simulation candle does not match analyzed closed candle','CANDLE_MISMATCH');
 if(!['CALL','PUT'].includes(simulation.signal))
  return standby(base,simulation,simulation.reason||'Historical analogues show no sufficient directional edge','NO_SIMULATION_EDGE');
 const p=ROUND16,fail=[];
 if(!Number.isFinite(simulation.sampleCount)||simulation.sampleCount<p.minAnalogueCount)fail.push('Insufficient historical analogues');
 if(!Number.isFinite(simulation.probabilityUp)||!Number.isFinite(simulation.probabilityDown))fail.push('Directional frequencies are unavailable');
 const directionalRate=simulation.signal==='CALL'?simulation.probabilityUp:simulation.probabilityDown;
 const expectedMove=simulation.expectedMoveAtr;
 if(!Number.isFinite(directionalRate)||directionalRate<p.minDirectionalRate)fail.push('Historical directional edge is below 58%');
 if(!Number.isFinite(expectedMove)||(simulation.signal==='CALL'?expectedMove<=0:expectedMove>=0))fail.push('Projected move does not support simulation direction');
 if(!Number.isFinite(simulation.riskScore)||simulation.riskScore>p.riskMax)fail.push('Adverse-outcome risk exceeds limit');
 if(!Number.isFinite(simulation.volatilityRatio)||simulation.volatilityRatio>p.volatilityRatioMax)fail.push('Extreme volatility exceeds 2.20');
 if(fail.length)return standby(base,simulation,fail.join('; '),'PARAMETER_BLOCKED');
 return{...base,signal:simulation.signal,reason:'Future Simulation primary direction accepted: '+directionalRate.toFixed(1)+'% historical analogue frequency',score:Math.round(directionalRate*100),strategy:'FUTURE_SIMULATION',
  safetyGate:{status:'PASSED',passed:true,mode:'SIMULATION_PRIMARY'},simulation:simulationSummary(simulation)};
}
module.exports={applySafetyGate,simulationSummary};
