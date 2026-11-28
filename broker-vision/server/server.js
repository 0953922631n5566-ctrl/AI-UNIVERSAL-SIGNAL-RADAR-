import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.VISION_API_TOKEN || "";
const MAX_FRAMES = 240;
const frames = [];
let latestFrameImage = null;
const STORAGE_DIR = process.env.VISION_STORAGE_DIR || "";
const deviceTokens = new Map();
const enrollAttempts = new Map();
const DEVICE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));

function auth(req, res, next) {
  if (!API_TOKEN) return res.status(503).json({ ok:false, error:"VISION_API_TOKEN is not configured" });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const deviceExpiry = deviceTokens.get(token) || 0;
  if (token !== API_TOKEN && deviceExpiry <= Date.now()) {
    deviceTokens.delete(token);
    return res.status(401).json({ ok:false, error:"Unauthorized or device token expired" });
  }
  next();
}
const finite = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function summarize(items) {
  const xs = items.filter(x => finite(x.price)).map(x => Number(x.price));
  if (xs.length < 2) return { direction:"WAIT", reason:"ต้องอ่านป้ายราคาได้ต่อเนื่องอย่างน้อย 2 ภาพ", confidence:0 };
  const first = xs[0], last = xs.at(-1), delta = last-first;
  const reportedPrecision = Number(frames.at(-1)?.pricePrecision);
  const decimals = Number.isInteger(reportedPrecision) && reportedPrecision>0
    ? reportedPrecision : (String(last).split(".")[1]?.length || 4);
  const tick = 10 ** (-Math.min(decimals,10));
  const steps = xs.slice(1).map((value,i)=>value-xs[i]);
  const up = steps.filter(value=>value>0).length;
  const down = steps.filter(value=>value<0).length;
  const dominance = steps.length ? Math.max(up,down)/steps.length : 0;
  const direction = Math.abs(delta)>=tick && dominance>=0.60
    ? (delta>0 ? "CALL" : "PUT") : "WAIT";
  const confidence = direction==="WAIT" ? 0
    : clamp(Math.round(45+(dominance-0.5)*70+Math.min(Math.abs(delta)/tick,4)*5),0,85);
  return { direction, priceChange:delta, tickSize:tick, directionalConsistency:Math.round(dominance*100),
    confidence, reason:direction==="WAIT"?"ราคาเคลื่อนไหวยังไม่ถึงอย่างน้อย 1 tick หรือทิศทางยังไม่สม่ำเสมอ":`ราคาเคลื่อนไหวต่อเนื่องในทิศทาง ${direction}` };
}
async function persistLatestFrame(frame, image) {
  if (!STORAGE_DIR) return;
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, "latest-frame.jpg"), Buffer.from(image.base64, "base64"));
  await writeFile(path.join(STORAGE_DIR, "latest-frame.json"), JSON.stringify({ ...frame, image: undefined }));
}
async function restoreLatestFrame() {
  if (!STORAGE_DIR) return;
  try {
    const [bytes, metadata] = await Promise.all([
      readFile(path.join(STORAGE_DIR, "latest-frame.jpg")),
      readFile(path.join(STORAGE_DIR, "latest-frame.json"), "utf8")
    ]);
    const frame = JSON.parse(metadata);
    frame.receivedAt = frame.receivedAt || new Date().toISOString();
    frames.push(frame);
    latestFrameImage = { mimeType: "image/jpeg", base64: bytes.toString("base64") };
    console.log("Restored latest Broker Vision frame from persistent storage");
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not restore latest frame:", error.message);
  }
}
function makeAnalysis() {
  const last = frames.at(-1);
  if (!last) return { signal:"WAIT", status:"NO_DATA", reason:"ยังไม่มีภาพจากอุปกรณ์" };
  const ageMs = Date.now() - Date.parse(last.receivedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10000)
    return { signal:"WAIT", status:"STALE_FRAME", reason:"ภาพล่าสุดเก่าเกิน 10 วินาที จึงหยุดสัญญาณ", ageMs:Number.isFinite(ageMs)?ageMs:null };
  if (last.symbol === "UNKNOWN" || last.timeframe === "UNKNOWN")
    return { signal:"WAIT", status:"INSTRUMENT_UNIDENTIFIED", reason:"ยังระบุสินทรัพย์หรือกรอบเวลาไม่ชัดเจน จึงงดออกสัญญาณ" };
  const recent = frames.filter(x=>x.symbol===last.symbol && x.timeframe===last.timeframe).slice(-12);
  const candles = Array.isArray(last.candles) ? last.candles : [];
  const price = Number(last.price);
  const readable = finite(price) && price > 0;
  const trend = summarize(recent.filter(x => finite(x.price)));
  const candleCount = candles.length;
  const quality = clamp(Math.round((readable?40:0) + Math.min(candleCount,8)*5 + (last.ocr?.length?10:0)),0,100);
  const completedCandles = candles.length>1 ? candles.slice(0,-1) : [];
  if (!readable || completedCandles.length < 3 || quality < 60) {
    return { signal:"WAIT", status:"INSUFFICIENT_VISUAL_DATA", reason:"ข้อมูลภาพยังไม่ครบ: ต้องอ่านราคาและแท่งเทียนที่ปิดแล้วได้ชัดเจน", quality, price:readable?price:null, candleCount, completedCandleCount:completedCandles.length, analyzedAt:new Date().toISOString() };
  }
  const bodies = completedCandles.slice(-5).map(c => Number(c.closeY)-Number(c.openY)).filter(finite);
  const bodyBias = bodies.reduce((a,b)=>a+b,0);
  const candleDirection = bodyBias < -1 ? "CALL" : bodyBias > 1 ? "PUT" : "WAIT";
  const agree = trend.direction === candleDirection && trend.direction !== "WAIT";
  const signal = agree ? trend.direction : "WAIT";
  const axis=(last.axisPrices||[]).filter(p=>finite(p.price)&&finite(p.y)).sort((a,b)=>Number(a.y)-Number(b.y));
  const axisCalibrated=axis.length>=2 && Math.abs(Number(axis.at(-1).y)-Number(axis[0].y))>10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price))>0;
  const yToPrice=y=>{
    if(!axisCalibrated||!finite(y))return null;
    const a=axis[0],z=axis.at(-1);
    return Number(a.price)+(Number(y)-Number(a.y))*(Number(z.price)-Number(a.price))/(Number(z.y)-Number(a.y));
  };
  const candlePriceLevels=axisCalibrated?completedCandles.slice(-5).map(c=>({
    open:yToPrice(c.openY),close:yToPrice(c.closeY),high:yToPrice(c.highY),low:yToPrice(c.lowY)
  })): [];
  return { signal, status:"ANALYZED", price, candleCount, completedCandleCount:completedCandles.length, quality,
    priceAxisCalibrated:axisCalibrated,candlePriceLevels,
    confidence:signal==="WAIT"?Math.min(trend.confidence,45):Math.min(85,Math.round((trend.confidence+quality)/2)),
    reason:signal==="WAIT"?"ราคาและรูปทรงแท่งเทียนยังไม่ยืนยันไปในทิศทางเดียวกัน":`ราคาและแท่งเทียนยืนยัน ${signal} ตรงกัน`,
    priceMomentum:trend, candleBias:candleDirection, analyzedAt:new Date().toISOString(),
    note:"ระดับ OHLC ที่คำนวณจากพิกเซลเป็นค่าประมาณและใช้ได้เมื่ออ่านแกนราคาได้อย่างน้อย 2 จุด คะแนนความมั่นใจไม่ใช่ความน่าจะเป็นหรืออัตราชนะที่พิสูจน์แล้ว" };
}

app.get("/health", (_req,res)=>res.json({ok:true,service:"universal-broker-vision",version:"0.2.0",receivedFrames:frames.length,tokenConfigured:Boolean(API_TOKEN),demoEnrollment:process.env.VISION_DEMO_ENROLLMENT==="true"}));
app.post("/api/vision/enroll", (req,res)=>{
  if (process.env.VISION_DEMO_ENROLLMENT !== "true")
    return res.status(503).json({ok:false,error:"Device enrollment is disabled"});
  const now=Date.now();
  for (const [key,expiry] of deviceTokens) if (expiry<=now) deviceTokens.delete(key);
  const ip=String(req.ip||req.socket.remoteAddress||"unknown");
  const attempts=(enrollAttempts.get(ip)||[]).filter(ts=>now-ts<60*60*1000);
  if (attempts.length>=10) return res.status(429).json({ok:false,error:"Too many enrollments; try again later"});
  attempts.push(now);enrollAttempts.set(ip,attempts);
  const token=randomUUID()+randomUUID();
  deviceTokens.set(token,now+DEVICE_TOKEN_TTL_MS);
  res.status(201).json({ok:true,token,expiresAt:new Date(now+DEVICE_TOKEN_TTL_MS).toISOString(),expiresInSeconds:DEVICE_TOKEN_TTL_MS/1000});
});
app.get("/vision", (_req,res)=>res.sendFile(path.resolve("public/vision.html")));
app.get("/api/vision/public", (_req,res)=>{
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,candleCount:last?.candles?.length||0,
    imageDataUri:latestFrameImage?`data:${latestFrameImage.mimeType};base64,${latestFrameImage.base64}`:null,
    analysis:makeAnalysis()});
});
app.post("/api/vision/frame", auth, (req,res)=>{
  const b=req.body||{};
  if (!finite(b.width)||!finite(b.height)||!Array.isArray(b.ocr)||!Array.isArray(b.candles))
    return res.status(400).json({ok:false,error:"Expected width, height, ocr[], and candles[]"});
  if (typeof b.imageBase64 !== "string" || b.imageBase64.length < 100 || b.imageBase64.length > 5_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.imageBase64))
    return res.status(400).json({ok:false,error:"A real JPEG chart image is required (imageBase64, max 3.75 MB)"});
  const imageBytes=Buffer.from(b.imageBase64,"base64");
  if (imageBytes.length < 75 || imageBytes.length > 3_750_000 || imageBytes[0]!==0xff || imageBytes[1]!==0xd8 || imageBytes.at(-2)!==0xff || imageBytes.at(-1)!==0xd9)
    return res.status(400).json({ok:false,error:"imageBase64 must contain a valid JPEG image"});
  const texts=b.ocr.map(x=>String(x.text||"").trim()).filter(Boolean);
  const priceCandidate=texts.map(t=>t.replace(/,/g,"").match(/\d+(?:\.\d{3,8})?/g)?.at(-1)).find(Boolean);
  const price=finite(b.price)?Number(b.price):(priceCandidate?Number(priceCandidate):null);
  const frame={id:randomUUID(),receivedAt:new Date().toISOString(),deviceTime:b.deviceTime||null,
    width:Number(b.width),height:Number(b.height),symbol:String(b.symbol||"UNKNOWN").slice(0,40),
    timeframe:String(b.timeframe||"UNKNOWN").slice(0,20),price,
    pricePrecision:finite(b.pricePrecision)?clamp(Math.round(Number(b.pricePrecision)),0,10):null,
    axisPrices:Array.isArray(b.axisPrices)?b.axisPrices.slice(0,30):[],
    ocr:b.ocr.slice(0,100),
    candles:b.candles.slice(-100),chart:b.chart||null};
  frames.push(frame); if(frames.length>MAX_FRAMES) frames.splice(0,frames.length-MAX_FRAMES);
  latestFrameImage={mimeType:"image/jpeg",base64:b.imageBase64};
  void persistLatestFrame(frame,latestFrameImage).catch(error=>console.error("Frame persistence failed:",error.message));
  const analysis=makeAnalysis();
  res.status(202).json({ok:true,frameId:frame.id,receivedAt:frame.receivedAt,imageReceived:true,imageBytes:imageBytes.length,analysis});
});
app.get("/api/vision/snapshot", auth, (_req,res)=>res.json({ok:true,analysis:makeAnalysis(),frames:frames.slice(-20)}));
app.get("/api/vision/status", auth, (_req,res)=>res.json({ok:true,frames:frames.length,lastFrame:frames.at(-1)?.receivedAt||null,analysis:makeAnalysis()}));
await restoreLatestFrame();\napp.listen(PORT,"0.0.0.0",()=>console.log(`Universal Broker Vision API listening on ${PORT}; persistent storage ${STORAGE_DIR ? "enabled" : "not configured"}`));