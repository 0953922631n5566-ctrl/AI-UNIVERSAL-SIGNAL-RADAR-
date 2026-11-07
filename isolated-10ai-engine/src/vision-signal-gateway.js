'use strict';
const {decodeBase64Image,parseMultipart}=require('./vision-input-gateway');
function send(res,status,payload){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(payload));}
async function readBody(req,maxBytes){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>maxBytes*1.5+65536){const e=new Error('Request too large');e.status=413;throw e;}chunks.push(c);}return Buffer.concat(chunks);}
function createVisionSignalHandler({visionAdapter,maxBytes=8*1024*1024}={}){
 return async function(req,res){
  if(new URL(req.url,'http://localhost').pathname!=='/api/v1/vision/signal')return send(res,404,{error:'NOT_FOUND'});
  if(req.method!=='POST'){res.setHeader('allow','POST');return send(res,405,{error:'METHOD_NOT_ALLOWED'});}
  try{
   const raw=await readBody(req,maxBytes),ct=String(req.headers['content-type']||'');let image=null,context={};
   if(ct.toLowerCase().includes('application/json')){
    let input;try{input=JSON.parse(raw.toString('utf8'));}catch{const e=new Error('Request body must be valid JSON');e.status=400;throw e;}
    image=decodeBase64Image(input.imageBase64,input.mimeType,maxBytes);context=input.chartContext||{};
   }else if(ct.toLowerCase().includes('multipart/form-data')){
    const parts=parseMultipart(raw,ct,maxBytes);if(!parts.image){const e=new Error('image file is required');e.status=400;throw e;}
    image=parts.image;try{context=JSON.parse(parts.chartContext||'{}');}catch{const e=new Error('chartContext must be valid JSON');e.status=400;throw e;}
   }else{const e=new Error('Use application/json or multipart/form-data');e.status=415;throw e;}
   const result=await visionAdapter(image,context);
   return send(res,200,{ok:true,...result});
  }catch(e){const status=Number.isInteger(e.status)?e.status:500;return send(res,status,{error:e.code||'VISION_ANALYSIS_FAILED',message:e.message});}
 };
}
module.exports={createVisionSignalHandler};
