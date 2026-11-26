import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SYMBOLS } from "../src/config.js";
import { fetchCandles } from "../src/twelve-data.js";
import { TwelveDataKeyPool } from "../src/twelve-data-pool.js";
const serverSource=readFileSync(new URL("../server.js",import.meta.url),"utf8");
test("selecting a configured pair loads its own REST history before Streaming restart",()=>{
 const start=serverSource.indexOf("async function select(symbolValue) {"),end=serverSource.indexOf("\nfunction stop(",start);
 assert.ok(start>=0&&end>start);
 const body=serverSource.slice(start,end),syncAt=body.indexOf("await syncSelected({ force: true, symbol });"),streamAt=body.indexOf("if (wasMonitoring && monitoring) startStream();");
 assert.ok(syncAt>=0&&streamAt>syncAt);
});
test("public EMA5 status requires a fresh streaming tick and returns REST/API key state",()=>{
 assert.match(serverSource,/tickAge!==null&&tickAge<=5\?feed\.lastTick:null/);
 assert.match(serverSource,/apiPool:twelveDataKeyPool\.publicStatus\(\)/);
 assert.match(serverSource,/manualOnly:true,brokerExecution:false/);
});
test("Twelve Data REST request is correctly formed for all four configured pairs",async()=>{
 const now=Date.UTC(2026,10,11,12,0,0);
 const values=Array.from({length:100},(_,index)=>({datetime:new Date(now-(100-index)*60000).toISOString().slice(0,16).replace("T"," "),open:"1.1000",high:"1.1010",low:"1.0990",close:"1.1005"}));
 for(const symbol of SYMBOLS){
  const pool=new TwelveDataKeyPool(["test-key"]);let requestedSymbol=null;
  const result=await fetchCandles({keyPool:pool,symbol,now,fetchImpl:async(url,options)=>{
   requestedSymbol=new URL(url).searchParams.get("symbol");assert.equal(options.headers.Authorization,"apikey test-key");
   return{ok:true,status:200,json:async()=>({meta:{symbol,interval:"1min"},values})};
  }});
  assert.equal(requestedSymbol,symbol);assert.equal(result.symbol,symbol);assert.equal(result.candles.length,100);
 }
});
