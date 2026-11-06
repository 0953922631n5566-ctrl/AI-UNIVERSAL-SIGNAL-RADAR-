const COOLDOWNS = Object.freeze({ RATE_LIMIT: 15*60*1000, AUTH_OR_PERMISSION: 60*60*1000, TRANSIENT: 30*1000, PROVIDER_ERROR: 30*1000 });
function parseConfiguredKeys(env=process.env){
 const raw=env.TWELVE_DATA_API_KEYS||"";let parsed=[];
 if(raw.trim()){try{const v=JSON.parse(raw);parsed=Array.isArray(v)?v:[v];}catch{parsed=raw.split(/[,;\\s]+/);}}
 if(!parsed.length)for(let i=1;i<=10;i++)if(env[`TWELVE_DATA_API_KEY_${i}`])parsed.push(env[`TWELVE_DATA_API_KEY_${i}`]);
 if(!parsed.length&&env.TWELVE_DATA_API_KEY)parsed.push(env.TWELVE_DATA_API_KEY);
 return [...new Set(parsed.map(v=>String(v??"").trim()).filter(Boolean))];
}
export class TwelveDataKeyPool{
 constructor(keys=parseConfiguredKeys()){this.keys=[...new Set(keys.map(v=>String(v??"").trim()).filter(Boolean))];this.activeIndex=0;this.cooldowns=new Map();this.failures=new Map();this.successAt=new Map();this.keyErrors=new Map();this.lastError=null;}
 get keyCount(){return this.keys.length;}
 getCandidates(){if(!this.keys.length)return[];const now=Date.now();const ordered=this.keys.map((key,index)=>({key,index})).sort((a,b)=>((a.index-this.activeIndex+this.keys.length)%this.keys.length)-((b.index-this.activeIndex+this.keys.length)%this.keys.length));return ordered.filter(x=>(this.cooldowns.get(x.key)||0)<=now).map(x=>x.key);}
 getActiveKey(){return this.getCandidates()[0]||null;}
 markSuccess(key){if(!key)return;this.cooldowns.delete(key);this.failures.delete(key);this.keyErrors.delete(key);this.successAt.set(key,Date.now());const i=this.keys.indexOf(key);if(i>=0)this.activeIndex=i;this.lastError=null;}
 markFailure(key,error){if(!key)return;const kind=error?.kind||"TRANSIENT";const until=Date.now()+(COOLDOWNS[kind]||COOLDOWNS.TRANSIENT);this.cooldowns.set(key,until);this.failures.set(key,(this.failures.get(key)||0)+1);this.keyErrors.set(key,{kind,message:String(error?.message||error||"Provider error"),until});const i=this.keys.indexOf(key);if(i>=0&&this.keys.length)this.activeIndex=(i+1)%this.keys.length;this.lastError={kind,message:String(error?.message||error||"Provider error")};}
 nextAvailableInMs(){if(!this.keys.length)return null;if(this.getCandidates().length)return 0;return Math.max(1000,Math.min(...this.keys.map(k=>this.cooldowns.get(k)||Date.now()))-Date.now());}
 publicStatus(){
  const now=Date.now();const active=this.getActiveKey();const availableCount=this.keys.filter(k=>(this.cooldowns.get(k)||0)<=now).length;
  return {configured:this.keys.length>0,configuredCount:this.keys.length,availableCount,activeKeyNumber:active?this.keys.indexOf(active)+1:null,rotation:this.keys.length>1?"FAILOVER_POOL":this.keys.length===1?"SINGLE_KEY":"UNCONFIGURED",
   keys:this.keys.map((key,index)=>{const err=this.keyErrors.get(key);const until=this.cooldowns.get(key)||0;return {number:index+1,status:until>now?(err?.kind==="RATE_LIMIT"?"QUOTA_COOLDOWN":err?.kind==="AUTH_OR_PERMISSION"?"AUTH_ERROR":"TEMPORARY_ERROR"):key===active?"ACTIVE":this.successAt.has(key)?"READY":"AVAILABLE",available:until<=now,active:key===active,lastSuccessAt:this.successAt.has(key)?new Date(this.successAt.get(key)).toISOString():null,retryAt:until>now?new Date(until).toISOString():null,failureCount:this.failures.get(key)||0,message:err?.message||""};}),
   lastFailure:this.lastError?{kind:this.lastError.kind,message:this.lastError.message}:null};
 }
}
export const twelveDataKeyPool=new TwelveDataKeyPool();
