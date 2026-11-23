import test from "node:test";
import assert from "node:assert/strict";
import { fetchEma5, fetchMomentum9 } from "../src/twelve-data.js";
const now=Date.parse("2026-11-23T12:02:30Z");
const keyPool={getRestCandidates:()=>["test-key"],markRestSuccess:()=>{},markFailure:()=>assert.fail("unexpected key failure")};
function mock(values){return async url=>({ok:true,status:200,json:async()=>({status:"ok",meta:{symbol:"EUR/USD",interval:"1min"},values})});}
test("fetchEma5 calls Twelve Data /ema with period 5",async()=>{let u;const r=await fetchEma5({keyPool,now,fetchImpl:async url=>{u=new URL(url);return{ok:true,status:200,json:async()=>({status:"ok",values:[{datetime:"2026-11-23 12:02:00",ema:"1.1003"},{datetime:"2026-11-23 12:01:00",ema:"1.1002"},{datetime:"2026-11-23 12:00:00",ema:"1.1001"}]})};}});assert.equal(u.pathname,"/ema");assert.equal(u.searchParams.get("time_period"),"5");assert.deepEqual(r.values.map(x=>x.ema),[1.1001,1.1002]);});
test("fetchMomentum9 calls Twelve Data /mom with period 9 and parses native mom field",async()=>{let u;const r=await fetchMomentum9({keyPool,now,fetchImpl:async url=>{u=new URL(url);return{ok:true,status:200,json:async()=>({status:"ok",meta:{indicator:{name:"MOM - Momentum",time_period:9}},values:[{datetime:"2026-11-23 12:02:00",mom:"0.0003"},{datetime:"2026-11-23 12:01:00",mom:"0.0002"},{datetime:"2026-11-23 12:00:00",mom:"0.0001"}]})};}});assert.equal(u.pathname,"/mom");assert.equal(u.searchParams.get("time_period"),"9");assert.equal(u.searchParams.get("series_type"),"close");assert.deepEqual(r.values.map(x=>x.momentum),[.0001,.0002]);assert.equal(r.source,"Twelve Data /mom");});
test("fetchMomentum9 rejects incomplete closed M1 output",async()=>{await assert.rejects(()=>fetchMomentum9({keyPool,now,fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:"ok",values:[{datetime:"2026-11-23 12:01:00",mom:"0.1"}]})})}),/two consecutive completed M1 values/);});


test("fetchEma5 fails over to the next Twelve Data key after a quota response",async()=>{
 const attempts=[],failures=[],successes=[];
 const pool={getRestCandidates:()=>["key-1","key-2","key-3"],markFailure:(key,error)=>failures.push({key,kind:error.kind}),markRestSuccess:key=>successes.push(key)};
 const r=await fetchEma5({keyPool:pool,now,fetchImpl:async(url,options)=>{
  const key=options.headers.Authorization.split(" ").at(-1);attempts.push(key);
  if(key==="key-1")return{ok:false,status:429,json:async()=>({status:"error",message:"API credits quota exceeded"})};
  return{ok:true,status:200,json:async()=>({status:"ok",values:[{datetime:"2026-11-23 12:01:00",ema:"1.1002"},{datetime:"2026-11-23 12:00:00",ema:"1.1001"}]})};
 }});
 assert.deepEqual(attempts,["key-1","key-2"]);assert.deepEqual(failures,[{key:"key-1",kind:"RATE_LIMIT"}]);assert.deepEqual(successes,["key-2"]);assert.equal(r.values.length,2);
});

test("fetchMomentum9 fails over to the next Twelve Data key after a quota response",async()=>{
 const attempts=[],failures=[],successes=[];
 const pool={getRestCandidates:()=>["key-1","key-2","key-3"],markFailure:(key,error)=>failures.push({key,kind:error.kind}),markRestSuccess:key=>successes.push(key)};
 const r=await fetchMomentum9({keyPool:pool,now,fetchImpl:async(url,options)=>{
  const key=options.headers.Authorization.split(" ").at(-1);attempts.push(key);
  if(key==="key-1")return{ok:false,status:429,json:async()=>({status:"error",message:"API credits quota exceeded"})};
  return{ok:true,status:200,json:async()=>({status:"ok",values:[{datetime:"2026-11-23 12:01:00",mom:"0.0002"},{datetime:"2026-11-23 12:00:00",mom:"0.0001"}]})};
 }});
 assert.deepEqual(attempts,["key-1","key-2"]);assert.deepEqual(failures,[{key:"key-1",kind:"RATE_LIMIT"}]);assert.deepEqual(successes,["key-2"]);assert.equal(r.values.length,2);
});

import { fetchTrendEma5, fetchEma20, fetchAtr14 } from "../src/twelve-data.js";
const fourClosed=[
 {datetime:"2026-11-23 12:01:00",ema:"1.1004",atr:"0.00014"},
 {datetime:"2026-11-23 12:00:00",ema:"1.1003",atr:"0.00013"},
 {datetime:"2026-11-23 11:59:00",ema:"1.1002",atr:"0.00012"},
 {datetime:"2026-11-23 11:58:00",ema:"1.1001",atr:"0.00011"}
];
test("Engine 3 requests native EMA5 and EMA20 from Twelve Data",async()=>{
 const seen=[];
 for(const [fn,period] of [[fetchTrendEma5,5],[fetchEma20,20]]){
  const result=await fn({keyPool,now,fetchImpl:async url=>{const u=new URL(url);seen.push({path:u.pathname,period:u.searchParams.get("time_period")});return{ok:true,status:200,json:async()=>({status:"ok",values:fourClosed.map(x=>({datetime:x.datetime,ema:x.ema}))})};}});
  assert.equal(result.values.length,4);assert.equal(result.period,period);
 }
 assert.deepEqual(seen,[{path:"/ema",period:"5"},{path:"/ema",period:"20"}]);
});
test("Engine 3 requests native ATR14 from Twelve Data without local calculation",async()=>{
 let request;
 const result=await fetchAtr14({keyPool,now,fetchImpl:async url=>{request=new URL(url);return{ok:true,status:200,json:async()=>({status:"ok",values:fourClosed.map(x=>({datetime:x.datetime,atr:x.atr}))})};}});
 assert.equal(request.pathname,"/atr");assert.equal(request.searchParams.get("time_period"),"14");
 assert.equal(request.searchParams.has("series_type"),false);assert.equal(result.values.length,4);
 assert.equal(result.values.at(-1).atr,.00014);
});
