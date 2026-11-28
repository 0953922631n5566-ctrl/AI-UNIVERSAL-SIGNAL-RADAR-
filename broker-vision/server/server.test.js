import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

test("vision API guards uploads and emits price-only signals without instrument gating", async (t) => {
  const probe = net.createServer();
  await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(0,"127.0.0.1",resolve);});
  const port = probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const serverPath = new URL("./server.js",import.meta.url).pathname;
  const child = spawn(process.execPath,[serverPath],{
    cwd:new URL(".",import.meta.url).pathname,
    env:{...process.env,PORT:String(port),VISION_API_TOKEN:"test-token",VISION_DEMO_ENROLLMENT:"true"},
    stdio:"ignore"
  });
  t.after(()=>{child.kill("SIGTERM");});
  const base = `http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<50;i++){
    try{const response=await fetch(base+"/health");if(response.ok){ready=true;break;}}catch{}
    await delay(100);
  }
  assert.equal(ready,true,"API should start within five seconds");

  const unauth=await fetch(base+"/api/vision/status");
  assert.equal(unauth.status,401);
  const enrollment=await fetch(base+"/api/vision/enroll",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(enrollment.status,201);
  const enrolled=await enrollment.json();
  assert.equal(typeof enrolled.token,"string");
  assert.ok(enrolled.token.length>=64);

  const candles=Array.from({length:5},()=>({color:"GREEN",openY:120,closeY:90,highY:88,lowY:122}));
  const imageBase64="/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/AIQ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=";
  let last;
  for(let i=0;i<4;i++){
    const response=await fetch(base+"/api/vision/frame",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+enrolled.token},
      body:JSON.stringify({width:1536,height:691,symbol:"EUR/USD",timeframe:"1M",deviceTime:Date.now(),
        price:1.120235+i*0.000001,pricePrecision:6,axisPrices:[{price:1.122,y:100},{price:1.118,y:500}],ocr:[{text:"EUR/USD",left:200,top:100,right:300,bottom:120},{text:(1.120235+i*0.000001).toFixed(6),left:1400,top:300,right:1470,bottom:320}],candles})
    });
    assert.equal(response.status,202);
    last=await response.json();
    assert.equal(last.imageReceived,false,"APK price frames must not require screenshot bytes");
  }
  assert.equal(last.analysis.nextCandlePrediction.signal,"CALL");
  assert.ok(["WAITING_FOR_ENTRY_WINDOW","WATCH_WINDOW","NEXT_CANDLE_PREDICTED"].includes(last.analysis.status));
  assert.equal("score" in last.analysis,false,"signal decisions must not expose or depend on a score");
  assert.equal(last.analysis.signal, last.analysis.phase==="ORDER_WINDOW" ? "CALL" : "WAIT");
  assert.equal(last.analysis.signalConditions.passed, last.analysis.phase==="ORDER_WINDOW");

  const staleCapture=await fetch(base+"/api/vision/frame",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+enrolled.token},
    body:JSON.stringify({width:1536,height:691,symbol:"UNKNOWN",timeframe:"UNKNOWN",deviceTime:Date.now()-20000,
      price:1.12345,pricePrecision:5,ocr:[{text:"1.12345",left:1400,top:300,right:1470,bottom:320}],candles:[]})
  });
  assert.equal(staleCapture.status,409,"stale APK captures must be rejected");

  const publicState=await (await fetch(base+"/api/vision/public")).json();
  assert.equal("imageDataUri" in publicState,false,"public status must not expose broker screenshots");
  const miniResponse=await fetch(base+"/api/vision/miniapp");
  const miniState=await miniResponse.json();
  assert.equal(miniResponse.status,200);
  assert.equal(miniState.price,1.120238);
  assert.equal(miniState.analysis.nextCandlePrediction.signal,"CALL");
  assert.equal(miniState.analysis.signal, miniState.analysis.phase==="ORDER_WINDOW" ? "CALL" : "WAIT");
  assert.equal("imageDataUri" in miniState,false,"Mini App polling must not transfer the screenshot image");

  const badOcr=await fetch(base+"/api/vision/frame",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+enrolled.token},
    body:JSON.stringify({width:1536,height:691,symbol:"RENDER",timeframe:"UNKNOWN",deviceTime:Date.now(),
      price:14,pricePrecision:0,ocr:[{text:"RENDER",left:100,top:80,right:260,bottom:110},
        {text:"14",left:1400,top:300,right:1460,bottom:320}],candles:[]})
  });
  const badOcrBody=await badOcr.json();
  assert.equal(badOcrBody.analysis.signal,"WAIT","arbitrary page text and integer labels must never create a directional signal");
  assert.equal(badOcrBody.analysis.status,"PRICE_UNREADABLE");

  const switched=await fetch(base+"/api/vision/frame",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer test-token"},
    body:JSON.stringify({width:1536,height:691,symbol:"UNKNOWN",timeframe:"UNKNOWN",deviceTime:Date.now(),
      price:150.10,pricePrecision:2,ocr:[{text:"150.10",left:1400,top:300,right:1470,bottom:320}],candles:[]})
  });
  const switchedBody=await switched.json();
  assert.equal(switchedBody.analysis.signal,"WAIT","a newly selected chart starts a fresh price window");
  assert.equal(switchedBody.analysis.price,150.10,"decimal prices are accepted without a recognized pair name");
  assert.equal(switchedBody.analysis.priceSamples,1,"price history from a different chart scale must not be mixed");
});