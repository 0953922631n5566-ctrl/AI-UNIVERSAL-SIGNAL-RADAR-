import express from "express";
import path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.VISION_API_TOKEN || "";
const MAX_FRAMES = 240;
const SIGNAL_THRESHOLD = 40;
const frames = [];
let latestFrameImage = null;
const STORAGE_DIR = process.env.VISION_STORAGE_DIR || "";
const enrollAttempts = new Map();
const DEVICE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));

function validDeviceToken(token) {
  const parts = String(token).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", API_TOKEN).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(parts[3], "hex"); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function auth(req, res, next) {
  if (!API_TOKEN) return res.status(503).json({ ok:false, error:"VISION_API_TOKEN is not configured" });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token !== API_TOKEN && !validDeviceToken(token))
    return res.status(401).json({ ok:false, error:"Unauthorized or device token expired" });
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
  if (!last) return { signal:"WAIT", status:"NO_DATA", reason:"ยังไม่มีภาพจากอุปกรณ์", score:0, scoreThreshold:SIGNAL_THRESHOLD };
  const ageMs = Date.now() - Date.parse(last.receivedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10000)
    return { signal:"WAIT", status:"STALE_FRAME", reason:"ภาพล่าสุดเก่าเกิน 10 วินาที จึงหยุดสัญญาณ", ageMs:Number.isFinite(ageMs)?ageMs:null, score:0, scoreThreshold:SIGNAL_THRESHOLD };

  // Instrument name and chart timeframe are metadata only. Analyze the visible price stream
  // regardless of the broker's selected pair/market; do not gate on symbol or timeframe.
  const recent = frames.slice(-12);
  const price = Number(last.price);
  const readable = finite(price) && price > 0;
  const priceSamples = recent.filter(x => finite(x.price));
  const trend = summarize(priceSamples);
  const candleCount = Array.isArray(last.candles) ? last.candles.length : 0;
  const quality = clamp(Math.round((readable?40:0) + Math.min(priceSamples.length,12)*5 + (last.ocr?.length?10:0)),0,100);
  const candidateScore = trend.direction === "WAIT" ? 0 : clamp(Math.round((trend.confidence + quality) / 2),0,100);
  const signal = readable && candidateScore >= SIGNAL_THRESHOLD ? trend.direction : "WAIT";

  const candles = Array.isArray(last.candles) ? last.candles : [];
  const axis=(last.axisPrices||[]).filter(p=>finite(p.price)&&finite(p.y)).sort((a,b)=>Number(a.y)-Number(b.y));
  const axisCalibrated=axis.length>=2 && Math.abs(Number(axis.at(-1).y)-Number(axis[0].y))>10 &&
    Math.abs(Number(axis.at(-1).price)-Number(axis[0].price))>0;
  const yToPrice=y=>{
    if(!axisCalibrated||!finite(y))return null;
    const a=axis[0],z=axis.at(-1);
    return Number(a.price)+(Number(y)-Number(a.y))*(Number(z.price)-Number(a.price))/(Number(z.y)-Number(a.y));
  };
  const candlePriceLevels=axisCalibrated?candles.slice(-5).map(c=>({
    open:yToPrice(c.openY),close:yToPrice(c.closeY),high:yToPrice(c.highY),low:yToPrice(c.lowY)
  })): [];
  return { signal, status:readable?"ANALYZED_PRICE_ONLY":"PRICE_UNREADABLE", price:readable?price:null,
    candleCount, priceSamples:priceSamples.length, quality,
    priceAxisCalibrated:axisCalibrated,candlePriceLevels,
    score:candidateScore, scoreThreshold:SIGNAL_THRESHOLD, signalEligible:signal!=="WAIT",
    confidence:signal==="WAIT"?trend.confidence:candidateScore,
    reason:signal==="WAIT"?"ราคายังไม่เคลื่อนไหวต่อเนื่องพอหรืออ่านราคาไม่ได้":`ราคาที่อ่านจากภาพเคลื่อนไหวต่อเนื่องไปทาง ${signal}`,
    priceMomentum:trend, analyzedAt:new Date().toISOString(),
    note:"วิเคราะห์จากราคาที่อ่านได้บนกราฟ ไม่ใช้ชื่อคู่เงินหรือกรอบเวลาเป็นเงื่อนไข คะแนนไม่ใช่ความน่าจะเป็นหรืออัตราชนะที่พิสูจน์แล้ว" };
}

app.get("/health", (_req,res)=>res.json({ok:true,service:"universal-broker-vision",version:"0.2.0",receivedFrames:frames.length,tokenConfigured:Boolean(API_TOKEN),demoEnrollment:process.env.VISION_DEMO_ENROLLMENT==="true"}));
app.post("/api/vision/enroll", (req,res)=>{
  if (process.env.VISION_DEMO_ENROLLMENT !== "true")
    return res.status(503).json({ok:false,error:"Device enrollment is disabled"});
  const now=Date.now();
  const ip=String(req.ip||req.socket.remoteAddress||"unknown");
  const attempts=(enrollAttempts.get(ip)||[]).filter(ts=>now-ts<60*60*1000);
  if (attempts.length>=10) return res.status(429).json({ok:false,error:"Too many enrollments; try again later"});
  attempts.push(now);enrollAttempts.set(ip,attempts);
  const expiresAt=now+DEVICE_TOKEN_TTL_MS;
  const payload=`v1.${expiresAt}.${randomUUID()}`;
  const signature=createHmac("sha256",API_TOKEN).update(payload).digest("hex");
  const token=`${payload}.${signature}`;
  res.status(201).json({ok:true,token,expiresAt:new Date(expiresAt).toISOString(),expiresInSeconds:DEVICE_TOKEN_TTL_MS/1000});
});
app.get("/vision", (_req,res)=>res.sendFile(path.resolve("public/vision.html")));
app.get("/api/vision/miniapp", (_req,res)=>{
  res.setHeader("Cache-Control","no-store, no-cache, max-age=0, must-revalidate");
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,candleCount:last?.candles?.length||0,analysis:makeAnalysis()});
});
app.get("/api/vision/public", (_req,res)=>{
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,candleCount:last?.candles?.length||0,
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
  // Never treat arbitrary page text or integer labels as a broker instrument/price.
  const rawSymbol=String(b.symbol||"").toUpperCase().replace(/\s/g,"");
  const pairMatch=rawSymbol.match(/^([A-Z]{3})\/([A-Z]{3})(?:\(OTC\))?$/);
  const symbol=pairMatch?pairMatch[1]+"/"+pairMatch[2]+(rawSymbol.endsWith("(OTC)")?"(OTC)":""):"UNKNOWN";
  const rawTimeframe=String(b.timeframe||"").toUpperCase().trim();
  const timeframeMatch=rawTimeframe.match(/^([1-9]\d?)(S|M|H|D)$/);
  const timeframe=timeframeMatch?timeframeMatch[1]+timeframeMatch[2]:"UNKNOWN";
  const suppliedPrecision=finite(b.pricePrecision)?clamp(Math.round(Number(b.pricePrecision)),0,10):(String(b.price||"").split(".")[1]||"").length;
  const suppliedPrice=finite(b.price)&&Number(b.price)>0&&suppliedPrecision>=3?Number(b.price):null;
  const priceCandidates=b.ocr.map(x=>{
    const left=Number(x.left),right=Number(x.right),top=Number(x.top);
    if(!Number.isFinite(left)||!Number.isFinite(right)||left<Number(b.width)*0.60||right<=left||
       (Number.isFinite(top)&&(top<Number(b.height)*0.15||top>Number(b.height)*0.75))) return null;
    const match=[...String(x.text||"").replace(/,/g,"").matchAll(/\b\d+(?:\.\d{3,8})\b/g)].at(-1);
    return match?Number(match[0]):null;
  }).filter(value=>Number.isFinite(value)&&value>0);
  const price=suppliedPrice??priceCandidates.at(-1)??null;
  const pricePrecision=price===null?null:(suppliedPrice!==null?suppliedPrecision:(String(price).split(".")[1]||"").length);
  const frame={id:randomUUID(),receivedAt:new Date().toISOString(),deviceTime:b.deviceTime||null,
    width:Number(b.width),height:Number(b.height),symbol,
    timeframe,
    price,
    pricePrecision,
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
await restoreLatestFrame();
app.listen(PORT,"0.0.0.0",()=>console.log(`Universal Broker Vision API listening on ${PORT}; persistent storage ${STORAGE_DIR ? "enabled" : "not configured"}`));