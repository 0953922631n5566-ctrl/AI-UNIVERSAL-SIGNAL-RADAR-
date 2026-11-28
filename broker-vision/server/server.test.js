import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

test("vision API guards uploads, analyzes repeated frames, and isolates instruments", async (t) => {
  const probe = net.createServer();
  await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(0,"127.0.0.1",resolve);});
  const port = probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const serverPath = new URL("./server.js",import.meta.url).pathname;
  const child = spawn(process.execPath,[serverPath],{
    cwd:new URL(".",import.meta.url).pathname,
    env:{...process.env,PORT:String(port),VISION_API_TOKEN:"test-token"},
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

  const candles=Array.from({length:5},()=>({color:"GREEN",openY:120,closeY:90,highY:88,lowY:122}));
  let last;
  for(let i=0;i<4;i++){
    const response=await fetch(base+"/api/vision/frame",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer test-token"},
      body:JSON.stringify({width:1536,height:691,symbol:"EUR/USD",timeframe:"1M",
        price:1.120235+i*0.000001,ocr:[{text:"EUR/USD",left:200,top:100,right:300,bottom:120}],candles})
    });
    assert.equal(response.status,202);
    last=await response.json();
  }
  assert.equal(last.analysis.signal,"CALL");
  assert.equal(last.analysis.status,"ANALYZED");

  const switched=await fetch(base+"/api/vision/frame",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer test-token"},
    body:JSON.stringify({width:1536,height:691,symbol:"EUR/JPY",timeframe:"1M",
      price:150.100,ocr:[{text:"EUR/JPY",left:200,top:100,right:300,bottom:120}],candles})
  });
  const switchedBody=await switched.json();
  assert.equal(switchedBody.analysis.signal,"WAIT","a newly selected instrument must not reuse the previous pair's momentum");
});