import test from "node:test";
import assert from "node:assert/strict";
import { fetchTrendEma5, fetchEma20, fetchAtr14 } from "../src/twelve-data.js";
const now=Date.parse("2026-11-23T12:02:30Z");
const keyPool={getRestCandidates:()=>["test-key"],markRestSuccess:()=>{},markFailure:()=>assert.fail("unexpected key failure")};
const values=[
 {datetime:"2026-11-23 12:01:00",ema:"1.1004",atr:"0.00014"},
 {datetime:"2026-11-23 12:00:00",ema:"1.1003",atr:"0.00013"},
 {datetime:"2026-11-23 11:59:00",ema:"1.1002",atr:"0.00012"},
 {datetime:"2026-11-23 11:58:00",ema:"1.1001",atr:"0.00011"}
];
const atrValues=Array.from({length:34},(_,i)=>({datetime:new Date(Date.parse("2026-11-23T12:01:00Z")-(33-i)*60000).toISOString().slice(0,16).replace("T"," "),atr:"0.00014"}));
test("native EMA5 and EMA20 requests use Twelve Data indicator endpoints",async()=>{
 const seen=[];
 for(const [fn,period] of [[fetchTrendEma5,5],[fetchEma20,20]]){
  const result=await fn({keyPool,now,fetchImpl:async url=>{const u=new URL(url);seen.push({path:u.pathname,period:u.searchParams.get("time_period")});return{ok:true,status:200,json:async()=>({status:"ok",values:values.map(x=>({datetime:x.datetime,ema:x.ema}))})};}});
  assert.equal(result.values.length,4);assert.equal(result.period,period);
 }
 assert.deepEqual(seen,[{path:"/ema",period:"5"},{path:"/ema",period:"20"}]);
});
test("native ATR14 requests 34 completed values for historical volatility baseline",async()=>{
 let request;const result=await fetchAtr14({keyPool,now,fetchImpl:async url=>{request=new URL(url);return{ok:true,status:200,json:async()=>({status:"ok",values:atrValues})};}});
 assert.equal(request.pathname,"/atr");assert.equal(request.searchParams.get("time_period"),"14");
 assert.equal(request.searchParams.get("outputsize"),"40");assert.equal(request.searchParams.has("series_type"),false);
 assert.equal(result.values.length,34);assert.equal(result.values.at(-1).atr,.00014);
});
test("native ATR14 endpoint fails over after Twelve Data quota response",async()=>{
 const attempts=[],failures=[],successes=[];
 const pool={getRestCandidates:()=>["key-1","key-2"],markFailure:(key,error)=>failures.push({key,kind:error.kind}),markRestSuccess:key=>successes.push(key)};
 const result=await fetchAtr14({keyPool:pool,now,fetchImpl:async(url,options)=>{
  const key=options.headers.Authorization.split(" ").at(-1);attempts.push(key);
  if(key==="key-1")return{ok:false,status:429,json:async()=>({status:"error",message:"API credits quota exceeded"})};
  return{ok:true,status:200,json:async()=>({status:"ok",values:atrValues})};
 }});
 assert.deepEqual(attempts,["key-1","key-2"]);assert.deepEqual(failures,[{key:"key-1",kind:"RATE_LIMIT"}]);
 assert.deepEqual(successes,["key-2"]);assert.equal(result.values.length,34);
});
