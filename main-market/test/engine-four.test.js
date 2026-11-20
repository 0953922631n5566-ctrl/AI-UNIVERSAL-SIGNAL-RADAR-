import test from "node:test";
import assert from "node:assert/strict";
import {analyzeEarlyEntryEngine4,ENGINE4_COLLECTION_WINDOW_MS,ENGINE4_DECISION_AT_MS,ENGINE4_ENTRY_WINDOW_MS} from "../src/engine-four.js";
const epoch=1_800_000_060;
const closed=[
 {epoch:epoch-180,open:1.1000,close:1.1002,high:1.1003,low:1.0999,live:false},
 {epoch:epoch-120,open:1.1002,close:1.1004,high:1.1005,low:1.1001,live:false},
 {epoch:epoch-60,open:1.1004,close:1.1006,high:1.1007,low:1.1003,live:false}];
const live={epoch,open:1.1006,close:1.10065,high:1.1007,low:1.1005,live:false,provisional:true};
function stats(up=0.00005,down=0.00001,dir="UP",now=epoch*1000+55000){
 return {candleEpoch:epoch,firstPrice:live.open,previousPrice:live.close,upMovement:up,downMovement:down,totalTicks:50,
 recentSamples:[{at:now-4000,price:1.1005},{at:now-1000,price:dir==="DOWN"?1.10045:1.10055}]};}
function analyze({candles=closed,current=live,tickStats=stats(),elapsed=55}={}){
 return analyzeEarlyEntryEngine4([...candles,current],{livePreview:true,now:epoch*1000+elapsed*1000,tickStats,currentPrice:current.close});}
test("collects ticks until T-10 before publishing a candidate",()=>{
 const o=analyze({elapsed:49.999});assert.equal(o.ready,true);assert.equal(o.decisionMade,false);
 assert.equal(o.signal,null);assert.equal(o.status,"COLLECTING_PRICE_PRESSURE");});
test("T-10 exposes provisional CALL but does not finalize",()=>{
 const o=analyze({elapsed:50});assert.equal(o.signal,"CALL");assert.equal(o.candidateSignal,"CALL");
 assert.equal(o.decisionMade,false);assert.equal(o.status,"PREPARE_PRESSURE_CALL");assert.equal(o.metrics.closedCandlesUsed.length,3);});
test("T-5 finalizes CALL from three closed candles plus live tick path",()=>{
 const o=analyze();assert.equal(o.signal,"CALL");assert.equal(o.status,"ACCUMULATED_PRESSURE_CALL");
 assert.equal(o.decisionMade,true);assert.ok(o.metrics.totalUpMovement>o.metrics.totalDownMovement);
 assert.equal(o.metrics.closedCandlesUsed.length,3);assert.equal(o.metrics.phase,"T5_FINAL");});
test("finalizes PUT when accumulated downward pressure is greater",()=>{
 const falling=[
 {epoch:epoch-180,open:1.1010,close:1.1008,high:1.1011,low:1.1007,live:false},
 {epoch:epoch-120,open:1.1008,close:1.1006,high:1.1009,low:1.1005,live:false},
 {epoch:epoch-60,open:1.1006,close:1.1004,high:1.1007,low:1.1003,live:false}];
 const current={...live,open:1.1004,close:1.10035,high:1.1005,low:1.1003};
 const o=analyze({candles:falling,current,tickStats:stats(0.00001,0.00005,"DOWN")});
 assert.equal(o.signal,"PUT");assert.equal(o.status,"ACCUMULATED_PRESSURE_PUT");
 assert.ok(o.metrics.totalDownMovement>o.metrics.totalUpMovement);});
test("last five seconds are context only and cannot reverse accumulated direction",()=>{
 const o=analyze({tickStats:stats(0.00005,0.00001,"DOWN")});assert.equal(o.signal,"CALL");
 assert.equal(o.metrics.continuationDirection,"DOWN");assert.equal(o.metrics.continuationSupportsDominant,false);
 assert.match(o.reason,/ไม่เปลี่ยนทิศทางแรงสะสมหลัก/);});
test("tie produces no signal at T-5",()=>{
 const balanced=[
 {epoch:epoch-180,open:1.1000,close:1.1002,high:1.1003,low:1.0999,live:false},
 {epoch:epoch-120,open:1.1002,close:1.1000,high:1.1003,low:1.0999,live:false},
 {epoch:epoch-60,open:1.1000,close:1.1000,high:1.1003,low:1.0999,live:false}];
 const o=analyze({candles:balanced,tickStats:stats(0.00002,0.00002)});
 assert.equal(o.signal,null);assert.equal(o.decisionMade,true);assert.equal(o.status,"ACCUMULATED_PRESSURE_TIE");});
test("requires three valid closed candles",()=>{
 const o=analyze({candles:closed.slice(1)});assert.equal(o.ready,false);assert.equal(o.status,"INSUFFICIENT_CLOSED_CANDLES");});
test("requires live tick path",()=>{const o=analyze({tickStats:null});assert.equal(o.ready,false);assert.equal(o.status,"LIVE_TICK_PATH_NOT_READY");});
test("requires live candle preview",()=>{
 const o=analyze({current:{...live,provisional:false,live:false}});assert.equal(o.ready,false);assert.equal(o.status,"NOT_READY");});
test("T-10 and T-5 thresholds are exact",()=>{
 assert.equal(ENGINE4_COLLECTION_WINDOW_MS,50000);assert.equal(ENGINE4_DECISION_AT_MS,55000);
 assert.equal(ENGINE4_ENTRY_WINDOW_MS,60000);assert.equal(analyze({elapsed:54.999}).decisionMade,false);
 assert.equal(analyze({elapsed:55}).decisionMade,true);});
