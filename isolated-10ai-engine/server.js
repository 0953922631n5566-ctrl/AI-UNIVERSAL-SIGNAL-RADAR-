'use strict';
const http=require('node:http');
const {createGeminiVisionAdapter}=require('./src/gemini-vision-adapter');
const {createVisionSignalHandler}=require('./src/vision-signal-gateway');
const port=Number(process.env.PORT||8080);
const model=process.env.GEMINI_VISION_MODEL||'gemini-2.5-flash';
const adapter=createGeminiVisionAdapter();
const handler=createVisionSignalHandler({visionAdapter:adapter,maxBytes:8*1024*1024});
const server=http.createServer((req,res)=>{
 if(req.url==='/health'&&req.method==='GET'){
  res.writeHead(200,{'content-type':'application/json'});
  return res.end(JSON.stringify({ok:true,service:'isolated-ai-10-core-vision-test',visionProvider:'gemini',model,visionConfigured:Boolean(process.env.GEMINI_API_KEY)}));
 }
 return handler(req,res);
});
server.listen(port,'0.0.0.0',()=>process.stdout.write('VISUAL-SIGNAL-AI Gemini server listening on '+port+'\n'));
server.on('error',e=>{process.stderr.write('Server error: '+e.message+'\n');process.exitCode=1;});
